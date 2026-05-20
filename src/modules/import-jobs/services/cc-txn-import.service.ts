import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { appConfig } from '@/config/app.config'
import { GmailPollService } from '@/modules/import-jobs/services/gmail-poll.service'
import { ImportAlertService } from '@/modules/import-jobs/services/import-alert.service'
import { HdfcParser } from '@/modules/import-jobs/parsers/hdfc.parser'
import { IciciParser } from '@/modules/import-jobs/parsers/icici.parser'
import { SbiParser } from '@/modules/import-jobs/parsers/sbi.parser'
import {
  BankConfig,
  BankImportResult,
  BankImportStats,
  ImportRunSummary,
  ImportWindow,
  ImportWindowSource,
  ParsedBankTransaction,
  PersistableTransaction,
  PolledMessage,
} from '@/modules/import-jobs/types/import-contracts'

const JOB_KEY = 'cc_txn_import'
const IMPORT_ACTOR = 'import-job'

const DEFAULT_BANKS: BankConfig[] = [
  {
    bankKey: 'SBI_5965',
    account: 'SBI',
    cardLast4: '5965',
    labelName: appConfig.importLabelSbi,
    parserName: 'parseSbiTxn',
    fallbackStartDate: '2026-03-01',
  },
  {
    bankKey: 'HDFC_9335',
    account: 'HDFC',
    cardLast4: '9335',
    labelName: appConfig.importLabelHdfc,
    senderAllowlist: ['alerts@hdfcbank.bank.in', 'alerts@hdfcbank.net'],
    parserName: 'parseHdfcTxn',
    fallbackStartDate: '2026-03-01',
  },
  {
    bankKey: 'ICICI_SHARED',
    account: 'ICICI',
    cardLast4: 'XXXX',
    knownCards: ['5000', '9003'],
    labelName: appConfig.importLabelIcici,
    parserName: 'parseIciciTxn',
    fallbackStartDate: '2026-03-01',
  },
]

@Injectable()
export class CcTxnImportService {
  private readonly logger = new Logger(CcTxnImportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailPoll: GmailPollService,
    private readonly importAlert: ImportAlertService,
    private readonly sbiParser: SbiParser,
    private readonly hdfcParser: HdfcParser,
    private readonly iciciParser: IciciParser,
  ) {}

  async runImport(options: { dryRun?: boolean; bankKeys?: string[] } = {}): Promise<ImportRunSummary> {
    const startedAt = new Date()
    const dryRun = Boolean(options.dryRun)
    const banks = this.filterBanks(options.bankKeys)

    const bankResults: BankImportResult[] = []

    for (const bank of banks) {
      try {
        const result = await this.runImportForBank(bank, dryRun)
        bankResults.push(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        bankResults.push({
          bankKey: bank.bankKey,
          summary: `${bank.bankKey}: FAILED - ${message}`,
          error: message,
          stats: this.emptyStats(),
        })
      }
    }

    const aggregate = bankResults.reduce<BankImportStats>(
      (acc, r) => ({
        messages: acc.messages + r.stats.messages,
        messagesFromSearch: acc.messagesFromSearch + r.stats.messagesFromSearch,
        inserted: acc.inserted + r.stats.inserted,
        duplicates: acc.duplicates + r.stats.duplicates,
        skipped: acc.skipped + r.stats.skipped,
        parseMiss: acc.parseMiss + r.stats.parseMiss,
        parseErrors: acc.parseErrors + r.stats.parseErrors,
      }),
      this.emptyStats(),
    )

    const failureCount = bankResults.filter((r) => Boolean(r.error)).length
    const status =
      failureCount === 0 ? 'OK' : aggregate.inserted > 0 ? 'PARTIAL' : 'FAILURE'
    const completedAt = new Date()
    const summary: ImportRunSummary = {
      job: 'cc_txn_import',
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      elapsedMs: completedAt.getTime() - startedAt.getTime(),
      failureCount,
      aggregate,
      spendCapAlertSent: false,
      banks: bankResults,
    }

    await this.prisma.importJobRun.create({
      data: {
        jobKey: JOB_KEY,
        status,
        payload: summary as unknown as Prisma.InputJsonValue,
        startedAt,
        completedAt,
      },
    })

    if (failureCount > 0) {
      await this.importAlert.sendFailureEmail(
        '[PFT Import] Bank import failure',
        `Failures=${failureCount}, inserted=${aggregate.inserted}`,
      )
    }

    this.logger.log(
      `Import complete status=${status}, failures=${failureCount}, inserted=${aggregate.inserted}, dryRun=${dryRun}`,
    )
    return summary
  }

  private async runImportForBank(bank: BankConfig, dryRun: boolean): Promise<BankImportResult> {
    const window = await this.resolveWindow(bank)
    const startDate = window.startDate ?? bank.fallbackStartDate
    const messages = await this.gmailPoll.pollByLabel(bank.labelName, startDate)
    const filteredMessages =
      window.watermarkCutoffMs == null
        ? messages
        : messages.filter((m) => m.receivedAtMs > window.watermarkCutoffMs!)

    const existingKeys = await this.getExistingDedupKeys()
    const stats: BankImportStats = {
      messages: filteredMessages.length,
      messagesFromSearch: messages.length,
      inserted: 0,
      duplicates: 0,
      skipped: 0,
      parseMiss: 0,
      parseErrors: 0,
    }

    const persistableRows: PersistableTransaction[] = []
    let maxReceivedAtMs = 0

    for (const message of filteredMessages) {
      maxReceivedAtMs = Math.max(maxReceivedAtMs, message.receivedAtMs)

      if (bank.senderAllowlist?.length) {
        const from = message.from.toLowerCase()
        const allowed = bank.senderAllowlist.some((sender) => from.includes(sender.toLowerCase()))
        if (!allowed) {
          stats.skipped++
          continue
        }
      }

      try {
        const parsed = this.parseMessage(bank, message)
        if (!parsed) {
          stats.parseMiss++
          this.logParserMiss(bank.bankKey, message, 'parser_returned_null')
          continue
        }
        if (!this.validateCardRules(bank, parsed)) {
          stats.skipped++
          this.logParserMiss(bank.bankKey, message, 'card_rule_mismatch')
          continue
        }

        const dedupeKey = this.makeDedupKey(parsed)
        if (existingKeys.has(dedupeKey)) {
          stats.duplicates++
          continue
        }

        existingKeys.add(dedupeKey)
        persistableRows.push(this.toPersistable(parsed, dedupeKey))
      } catch {
        stats.parseErrors++
      }
    }

    if (!dryRun) {
      for (const row of persistableRows) {
        await this.upsertTransaction(row)
      }
      if (maxReceivedAtMs > 0) {
        await this.updateWatermark(bank, maxReceivedAtMs, window.source, startDate)
      }
    }

    stats.inserted = persistableRows.length
    return {
      bankKey: bank.bankKey,
      summary: `${bank.bankKey}: inserted ${stats.inserted} rows`,
      stats,
    }
  }

  private parseMessage(bank: BankConfig, message: PolledMessage): ParsedBankTransaction | null {
    switch (bank.parserName) {
      case 'parseSbiTxn':
        return this.sbiParser.parse(message)
      case 'parseHdfcTxn':
        return this.hdfcParser.parse(message)
      case 'parseIciciTxn':
        return this.iciciParser.parse(message)
      default:
        return null
    }
  }

  private validateCardRules(bank: BankConfig, parsed: ParsedBankTransaction): boolean {
    if (bank.knownCards?.length && !bank.knownCards.includes(parsed.cardLast4)) return false
    if (bank.cardLast4 && bank.cardLast4 !== 'XXXX' && bank.cardLast4 !== parsed.cardLast4) return false
    return true
  }

  private async resolveWindow(bank: BankConfig): Promise<ImportWindow> {
    const state = await this.prisma.importJobState.findUnique({
      where: { jobKey_bankKey: { jobKey: JOB_KEY, bankKey: bank.bankKey } },
    })

    if (state?.watermarkIso && state.watermarkCutoffMs != null) {
      const wm = Number(state.watermarkCutoffMs)
      const buffered = new Date(wm)
      buffered.setDate(buffered.getDate() - 1)
      return {
        startDate: buffered.toISOString().slice(0, 10),
        source: 'watermark',
        watermarkCutoffMs: wm,
      }
    }

    return {
      startDate: null,
      source: 'none',
      watermarkCutoffMs: null,
    }
  }

  private async updateWatermark(
    bank: BankConfig,
    watermarkCutoffMs: number,
    source: ImportWindowSource,
    lastStartDate: string,
  ): Promise<void> {
    await this.prisma.importJobState.upsert({
      where: { jobKey_bankKey: { jobKey: JOB_KEY, bankKey: bank.bankKey } },
      create: {
        jobKey: JOB_KEY,
        bankKey: bank.bankKey,
        watermarkIso: new Date(watermarkCutoffMs).toISOString(),
        watermarkCutoffMs: BigInt(watermarkCutoffMs),
        source,
        lastStartDate,
      },
      update: {
        watermarkIso: new Date(watermarkCutoffMs).toISOString(),
        watermarkCutoffMs: BigInt(watermarkCutoffMs),
        source,
        lastStartDate,
      },
    })
  }

  private async upsertTransaction(row: PersistableTransaction): Promise<void> {
    const card = await this.prisma.card.findFirst({
      where: { cardKey: row.cardKey },
      select: { id: true, tenantId: true },
    })
    if (!card) return

    try {
      await this.prisma.transaction.create({
        data: {
          tenantId: card.tenantId,
          cardId: card.id,
          txnDate: row.txnDate,
          txnTimestamp: row.txnTimestamp ?? undefined,
          amount: row.amount,
          merchant: row.merchant,
          channel: row.channel,
          bankKey: row.bankKey,
          emailId: row.emailId,
          dedupeKey: row.dedupeKey,
          importedAt: row.importedAt,
          referenceNo: row.referenceNo ?? undefined,
          externalId: row.externalId ?? undefined,
          createdBy: IMPORT_ACTOR,
          updatedBy: IMPORT_ACTOR,
        },
      })
    } catch {
      // Dedup unique constraint collision on retry/concurrent processing.
    }
  }

  private toPersistable(parsed: ParsedBankTransaction, dedupeKey: string): PersistableTransaction {
    return {
      txnDate: new Date(parsed.txnDate),
      txnTimestamp: parsed.txnTimestamp ? new Date(parsed.txnTimestamp) : null,
      cardKey: `${parsed.account.toUpperCase()}_XX${parsed.cardLast4}`,
      amount: parsed.amount,
      merchant: parsed.merchant,
      channel: parsed.channel,
      bankKey: parsed.bankKey,
      emailId: parsed.emailId,
      dedupeKey,
      importedAt: new Date(parsed.importedAt),
      referenceNo: parsed.referenceNo ?? null,
      externalId: null,
    }
  }

  private makeDedupKey(parsed: ParsedBankTransaction): string {
    const emailId = parsed.emailId.trim()
    if (emailId) return `EMAIL::${emailId}`

    const refNo = (parsed.referenceNo ?? '').trim()
    if (refNo) return `REF::${parsed.bankKey}::${refNo}`

    const card = `${parsed.account.toUpperCase()}_XX${parsed.cardLast4}`
    const merchant = parsed.merchant.trim().toUpperCase()
    return `FALLBACK::${card}::${parsed.txnTimestamp}::${parsed.amount}::${merchant}`
  }

  private async getExistingDedupKeys(): Promise<Set<string>> {
    const rows = await this.prisma.transaction.findMany({
      where: { dedupeKey: { not: null } },
      select: { dedupeKey: true },
      take: 10000,
      orderBy: { createdAt: 'desc' },
    })
    return new Set(rows.map((r) => r.dedupeKey!).filter(Boolean))
  }

  private filterBanks(bankKeys?: string[]): BankConfig[] {
    if (!bankKeys?.length) return DEFAULT_BANKS
    const wanted = new Set(bankKeys)
    return DEFAULT_BANKS.filter((b) => wanted.has(b.bankKey))
  }

  private emptyStats(): BankImportStats {
    return {
      messages: 0,
      messagesFromSearch: 0,
      inserted: 0,
      duplicates: 0,
      skipped: 0,
      parseMiss: 0,
      parseErrors: 0,
    }
  }

  private logParserMiss(bankKey: string, message: PolledMessage, reason: string): void {
    if (!appConfig.importDebugParserInput) return

    const maxLen = Number.isFinite(appConfig.importDebugBodyMaxLen)
      ? Math.max(200, appConfig.importDebugBodyMaxLen)
      : 1200
    const preview =
      message.body.length > maxLen ? `${message.body.slice(0, maxLen)} ...[truncated]` : message.body

    this.logger.warn(
      `[ParserMiss] bank=${bankKey} reason=${reason} id=${message.id} subject="${message.subject}" from="${message.from}" body="${preview}"`,
    )
  }
}
