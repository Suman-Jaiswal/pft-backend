import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { appConfig } from '@/config/app.config'
import { GmailPollService } from '@/modules/import-jobs/services/gmail-poll.service'
import { ImportAlertService } from '@/modules/import-jobs/services/import-alert.service'
import { ImportFailureService } from '@/modules/import-jobs/services/import-failure.service'
import { HdfcParser } from '@/modules/import-jobs/parsers/hdfc.parser'
import { IciciParser } from '@/modules/import-jobs/parsers/icici.parser'
import { SbiParser } from '@/modules/import-jobs/parsers/sbi.parser'
import {
  BankConfig,
  ImportFailureRetryResult,
  BankImportResult,
  BankImportStats,
  ImportErrorCode,
  ImportFailureType,
  ImportWindowSource,
  ImportRunSummary,
  ImportFailureListResult,
  ImportFailureStatus,
  ParsedBankTransaction,
  PolledMessage,
  WatermarkRebaseResult,
  ImportWindow,
  PersistableTransaction,
} from '@/modules/import-jobs/types/import-contracts'

const JOB_KEY = 'cc_txn_import'
const IMPORT_ACTOR = 'import-job'
const DEFAULT_REBASE_DAYS = 10
const REAUTH_REQUIRED_CODE: ImportErrorCode = 'REAUTH_REQUIRED'

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
    private readonly importFailureService: ImportFailureService,
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
        const errorCode = this.resolveImportErrorCode(error)
        bankResults.push({
          bankKey: bank.bankKey,
          summary: `${bank.bankKey}: FAILED - ${message}`,
          error: message,
          errorCode,
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
    const reauthRequired = bankResults.some((r) => r.errorCode === REAUTH_REQUIRED_CODE)
    const status =
      failureCount === 0 ? 'OK' : aggregate.inserted > 0 ? 'PARTIAL' : 'FAILURE'
    const completedAt = new Date()
    const summary: ImportRunSummary = {
      job: 'cc_txn_import',
      status,
      errorCode: reauthRequired ? REAUTH_REQUIRED_CODE : undefined,
      reauthRequired,
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
      writeFailures: 0,
      cardMissing: 0,
    }

    let inserted = 0
    let maxReceivedAtMs = 0

    for (const message of filteredMessages) {
      maxReceivedAtMs = Math.max(maxReceivedAtMs, message.receivedAtMs)
      const outcome = await this.processMessage(bank, message, existingKeys, dryRun)
      switch (outcome.kind) {
        case 'inserted':
          inserted++
          break
        case 'duplicate':
          stats.duplicates++
          break
        case 'skipped':
          stats.skipped++
          break
        case 'parse_miss':
          stats.parseMiss++
          break
        case 'parse_error':
          stats.parseErrors++
          break
        case 'write_failed':
          stats.writeFailures = (stats.writeFailures ?? 0) + 1
          break
        case 'card_missing':
          stats.cardMissing = (stats.cardMissing ?? 0) + 1
          break
        default:
          break
      }
    }

    if (!dryRun && maxReceivedAtMs > 0) {
      await this.updateWatermark(bank, maxReceivedAtMs, window.source, startDate)
    }

    stats.inserted = inserted
    return {
      bankKey: bank.bankKey,
      summary: `${bank.bankKey}: inserted ${stats.inserted} rows`,
      stats,
    }
  }

  async listFailures(filters: {
    status?: ImportFailureStatus
    failureType?: ImportFailureType
    bankKeys?: string[]
    page?: number
    pageSize?: number
  }): Promise<ImportFailureListResult> {
    return this.importFailureService.listFailures(filters)
  }

  async retryFailures(options: {
    ids?: string[]
    bankKeys?: string[]
    limit?: number
    dryRun?: boolean
  }): Promise<ImportFailureRetryResult> {
    const dryRun = Boolean(options.dryRun)
    const selected = await this.importFailureService.getFailuresForRetry({
      ids: options.ids,
      bankKeys: options.bankKeys,
      limit: options.limit,
    })
    const existingKeys = await this.getExistingDedupKeys()
    const breakdown: ImportFailureRetryResult['bankBreakdown'] = {}
    let resolved = 0
    let stillOpen = 0
    let notFoundInGmail = 0

    for (const failure of selected) {
      if (!breakdown[failure.bankKey]) {
        breakdown[failure.bankKey] = { attempted: 0, resolved: 0, stillOpen: 0, notFoundInGmail: 0 }
      }
      breakdown[failure.bankKey].attempted++
      if (!dryRun) {
        await this.importFailureService.markRetrying(failure.id)
      }
      const bank = this.getBankConfigByKey(failure.bankKey)
      if (!bank) {
        stillOpen++
        breakdown[failure.bankKey].stillOpen++
        if (!dryRun) {
          await this.importFailureService.markOpenWithError({
            id: failure.id,
            failureReason: 'unknown_bank_key',
            errorText: `Bank config not found for ${failure.bankKey}`,
          })
        }
        continue
      }

      const message = await this.gmailPoll.fetchByMessageId(failure.messageId)
      if (!message) {
        notFoundInGmail++
        breakdown[failure.bankKey].notFoundInGmail++
        if (!dryRun) {
          await this.importFailureService.markOpenWithError({
            id: failure.id,
            failureReason: 'gmail_message_not_found',
            errorText: `Gmail message ${failure.messageId} not found`,
          })
        }
        continue
      }

      const outcome = await this.processMessage(bank, message, existingKeys, dryRun, failure.id)
      if (outcome.kind === 'inserted' || outcome.kind === 'duplicate') {
        resolved++
        breakdown[failure.bankKey].resolved++
        if (!dryRun) {
          await this.importFailureService.markResolved({ id: failure.id, resolvedTxnId: outcome.txnId ?? null })
        }
        continue
      }

      stillOpen++
      breakdown[failure.bankKey].stillOpen++
      if (!dryRun) {
        await this.importFailureService.markOpenWithError({
          id: failure.id,
          failureReason: outcome.reason,
          errorText: outcome.errorText,
        })
      }
    }

    const attempted = selected.length
    return {
      selected: attempted,
      attempted,
      resolved,
      stillOpen,
      notFoundInGmail,
      bankBreakdown: breakdown,
    }
  }

  async rebaseWatermark(options: {
    days?: number
    bankKeys?: string[]
    dryRun?: boolean
  }): Promise<WatermarkRebaseResult> {
    const days = Math.max(1, Math.min(90, options.days ?? DEFAULT_REBASE_DAYS))
    const dryRun = Boolean(options.dryRun)
    const now = new Date()
    const watermarkDate = new Date(now)
    watermarkDate.setDate(watermarkDate.getDate() - days)
    const cutoffMs = watermarkDate.getTime()
    const banks = this.filterBanks(options.bankKeys)
    const rows: WatermarkRebaseResult['banks'] = []

    for (const bank of banks) {
      if (!dryRun) {
        await this.updateWatermark(bank, cutoffMs, 'watermark', watermarkDate.toISOString().slice(0, 10))
      }
      rows.push({
        bankKey: bank.bankKey,
        watermarkIso: watermarkDate.toISOString(),
        watermarkCutoffMs: cutoffMs,
        updated: !dryRun,
      })
    }

    return {
      dryRun,
      days,
      rebasedAtIso: now.toISOString(),
      banks: rows,
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

  private async upsertTransaction(row: PersistableTransaction): Promise<{
    kind: 'inserted' | 'duplicate' | 'card_missing' | 'write_failed'
    txnId?: string
    errorText?: string
  }> {
    const card = await this.prisma.card.findFirst({
      where: { cardKey: row.cardKey },
      select: { id: true, tenantId: true },
    })
    if (!card) return { kind: 'card_missing', errorText: `Card not found for key ${row.cardKey}` }

    try {
      const created = await this.prisma.transaction.create({
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
      return { kind: 'inserted', txnId: created.id }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { kind: 'duplicate' }
      }
      return { kind: 'write_failed', errorText: error instanceof Error ? error.message : String(error) }
    }
  }

  private async processMessage(
    bank: BankConfig,
    message: PolledMessage,
    existingKeys: Set<string>,
    dryRun: boolean,
    retryFailureId?: string,
  ): Promise<
    | { kind: 'inserted'; txnId?: string }
    | { kind: 'duplicate'; txnId?: string }
    | { kind: 'skipped'; reason: string; errorText?: string }
    | { kind: 'parse_miss'; reason: string; errorText?: string }
    | { kind: 'parse_error'; reason: string; errorText?: string }
    | { kind: 'write_failed'; reason: string; errorText?: string }
    | { kind: 'card_missing'; reason: string; errorText?: string }
  > {
    if (bank.senderAllowlist?.length) {
      const from = message.from.toLowerCase()
      const allowed = bank.senderAllowlist.some((sender) => from.includes(sender.toLowerCase()))
      if (!allowed) {
        return { kind: 'skipped', reason: 'sender_not_allowed' }
      }
    }

    try {
      const parsed = this.parseMessage(bank, message)
      if (!parsed) {
        this.logParserMiss(bank.bankKey, message, 'parser_returned_null')
        await this.importFailureService.upsertFailure({
          bankKey: bank.bankKey,
          message,
          failureType: 'PARSE_MISS',
          failureReason: 'parser_returned_null',
        })
        return { kind: 'parse_miss', reason: 'parser_returned_null' }
      }
      if (!this.validateCardRules(bank, parsed)) {
        this.logParserMiss(bank.bankKey, message, 'card_rule_mismatch')
        await this.importFailureService.upsertFailure({
          bankKey: bank.bankKey,
          message,
          failureType: 'CARD_RULE_MISMATCH',
          failureReason: 'card_rule_mismatch',
        })
        return { kind: 'skipped', reason: 'card_rule_mismatch' }
      }

      const dedupeKey = this.makeDedupKey(parsed)
      if (existingKeys.has(dedupeKey)) {
        return { kind: 'duplicate' }
      }

      existingKeys.add(dedupeKey)
      if (dryRun) {
        return { kind: 'inserted' }
      }

      const write = await this.upsertTransaction(this.toPersistable(parsed, dedupeKey))
      if (write.kind === 'inserted') {
        if (retryFailureId) {
          await this.importFailureService.markResolved({ id: retryFailureId, resolvedTxnId: write.txnId ?? null })
        }
        return { kind: 'inserted', txnId: write.txnId }
      }
      if (write.kind === 'duplicate') {
        if (retryFailureId) {
          await this.importFailureService.markResolved({ id: retryFailureId })
        }
        return { kind: 'duplicate' }
      }
      if (write.kind === 'card_missing') {
        await this.importFailureService.upsertFailure({
          bankKey: bank.bankKey,
          message,
          failureType: 'CARD_NOT_FOUND',
          failureReason: 'card_not_found',
          errorText: write.errorText,
        })
        return { kind: 'card_missing', reason: 'card_not_found', errorText: write.errorText }
      }

      await this.importFailureService.upsertFailure({
        bankKey: bank.bankKey,
        message,
        failureType: 'WRITE_FAILED',
        failureReason: 'write_failed',
        errorText: write.errorText,
      })
      return { kind: 'write_failed', reason: 'write_failed', errorText: write.errorText }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      await this.importFailureService.upsertFailure({
        bankKey: bank.bankKey,
        message,
        failureType: 'PARSE_ERROR',
        failureReason: 'parse_exception',
        errorText,
      })
      return { kind: 'parse_error', reason: 'parse_exception', errorText }
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

  private getBankConfigByKey(bankKey: string): BankConfig | null {
    return DEFAULT_BANKS.find((bank) => bank.bankKey === bankKey) ?? null
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

  private resolveImportErrorCode(error: unknown): ImportErrorCode | undefined {
    if (this.isReauthRequiredError(error)) {
      return REAUTH_REQUIRED_CODE
    }
    return undefined
  }

  private isReauthRequiredError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false

    const maybeError = error as {
      message?: unknown
      response?: { data?: { error?: unknown; error_description?: unknown } | unknown }
    }

    const message = String(maybeError.message ?? '').toLowerCase()
    if (message.includes('invalid_grant')) return true
    if (message.includes('reauth_required')) return true

    const responseData = maybeError.response?.data
    if (!responseData) return false

    if (typeof responseData === 'string') {
      return responseData.toLowerCase().includes('invalid_grant')
    }

    if (typeof responseData === 'object') {
      const errorCode = String((responseData as { error?: unknown }).error ?? '').toLowerCase()
      const errorDescription = String(
        (responseData as { error_description?: unknown }).error_description ?? '',
      ).toLowerCase()
      return errorCode.includes('invalid_grant') || errorDescription.includes('invalid_grant')
    }

    return false
  }
}
