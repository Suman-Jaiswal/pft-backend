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
  CcTxnGeminiParser,
  GeminiTxnBatchResult,
  GeminiTxnParse,
} from '@/modules/import-jobs/parsers/cc-txn-gemini.parser'
import {
  BankConfig,
  ImportFailureRetryResult,
  BankImportResult,
  BankImportStats,
  BankParserName,
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
import { resolveImportErrorCode } from '@/modules/import-jobs/services/import-auth-error.util'

const JOB_KEY = 'cc_txn_import'
const IMPORT_ACTOR = 'import-job'
const DEFAULT_REBASE_DAYS = 10
const REAUTH_REQUIRED_CODE: ImportErrorCode = 'REAUTH_REQUIRED'
const LABEL_KEY_PREFIX = 'LABEL:'

const LEGACY_WATERMARK_KEYS: Record<string, string> = {
  SBI: 'SBI_XX5965',
  HDFC: 'HDFC_XX9335',
  ICICI: 'ICICI_SHARED',
}

const LEGACY_BANK_KEYS = new Set(Object.values(LEGACY_WATERMARK_KEYS))

type WalletCard = {
  id: string
  tenantId: string
  cardKey: string
  issuer: string
  last4: string | null
  status: string
}

type ProcessOutcome =
  | { kind: 'inserted'; txnId?: string }
  | { kind: 'duplicate'; txnId?: string }
  | { kind: 'skipped'; reason: string; errorText?: string }
  | { kind: 'parse_miss'; reason: string; errorText?: string }
  | { kind: 'parse_error'; reason: string; errorText?: string }
  | { kind: 'write_failed'; reason: string; errorText?: string }
  | { kind: 'card_missing'; reason: string; errorText?: string }

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
    private readonly geminiParser: CcTxnGeminiParser,
  ) {}

  async runImport(options: {
    tenantId: string
    dryRun?: boolean
    bankKeys?: string[]
    /** When set, finalise this pre-created RUNNING row instead of inserting a new one. */
    runId?: string
  }): Promise<ImportRunSummary> {
    const startedAt = new Date()
    const dryRun = Boolean(options.dryRun)
    const bankResults: BankImportResult[] = []

    let folders: BankConfig[] = []
    try {
      this.logger.log(
        `[TXN_START] tenant=${options.tenantId} dryRun=${dryRun} bankKeys=${options.bankKeys?.join(',') || 'all'}`,
      )
      const cards = await this.loadWalletCards(options.tenantId)
      this.logger.log(
        `[TXN_WALLET] cards=${cards.length} issuers=${[...new Set(cards.map((c) => c.issuer))].join(',') || 'none'}`,
      )
      folders = this.filterFolders(await this.discoverFolders(options.tenantId, cards), options.bankKeys)
      this.logger.log(
        `[TXN_FOLDERS] count=${folders.length} keys=${folders.map((f) => f.bankKey).join(',') || 'none'}`,
      )

      for (const bank of folders) {
        try {
          const result = await this.runImportForBank(options.tenantId, bank, cards, dryRun)
          bankResults.push(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const errorCode = resolveImportErrorCode(error)
          bankResults.push({
            bankKey: bank.bankKey,
            summary: `${bank.bankKey}: FAILED - ${message}`,
            error: message,
            errorCode,
            stats: this.emptyStats(),
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errorCode = resolveImportErrorCode(error)
      bankResults.push({
        bankKey: 'DISCOVER',
        summary: `DISCOVER: FAILED - ${message}`,
        error: message,
        errorCode,
        stats: this.emptyStats(),
      })
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

    if (options.runId) {
      await this.prisma.importJobRun.update({
        where: { id: options.runId },
        data: {
          status,
          payload: summary as unknown as Prisma.InputJsonValue,
          completedAt,
        },
      })
    } else {
      await this.prisma.importJobRun.create({
        data: {
          jobKey: JOB_KEY,
          tenantId: options.tenantId,
          status,
          payload: summary as unknown as Prisma.InputJsonValue,
          startedAt,
          completedAt,
        },
      })
    }

    if (failureCount > 0) {
      await this.importAlert.sendFailureEmail(
        '[PFT Import] Bank import failure',
        `Failures=${failureCount}, inserted=${aggregate.inserted}`,
      )
    }

    this.logger.log(
      `[TXN_DONE] status=${status} failures=${failureCount} inserted=${aggregate.inserted} dryRun=${dryRun}`,
    )
    return summary
  }

  private async runImportForBank(
    tenantId: string,
    bank: BankConfig,
    cards: WalletCard[],
    dryRun: boolean,
  ): Promise<BankImportResult> {
    this.logger.log(`[TXN_FOLDER_START] bank=${bank.bankKey} label="${bank.labelName}" issuer=${bank.account}`)
    const window = await this.resolveWindow(bank)
    const startDate = window.startDate ?? bank.fallbackStartDate
    this.logger.log(
      `[TXN_WINDOW] bank=${bank.bankKey} source=${window.source} after=${startDate} cutoffMs=${window.watermarkCutoffMs ?? 'none'}`,
    )
    const messages = await this.gmailPoll.pollByLabel(tenantId, bank.labelName, startDate)
    const filteredMessages =
      window.watermarkCutoffMs == null
        ? messages
        : messages.filter((m) => m.receivedAtMs > window.watermarkCutoffMs!)
    this.logger.log(
      `[TXN_POLL] bank=${bank.bankKey} search=${messages.length} afterWatermark=${filteredMessages.length}`,
    )

    const existingKeys = await this.getExistingDedupKeys(tenantId)
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
    const chunks = this.chunkMessages(filteredMessages, this.geminiBatchSize())
    const gapMs = this.geminiBatchGapMs()

    this.logger.log(
      `[TXN_DRAIN] bank=${bank.bankKey} batches=${chunks.length} batchSize=${this.geminiBatchSize()} gapMs=${gapMs}`,
    )
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0 && gapMs > 0) {
        this.logger.log(`[TXN_GEMINI_WAIT] bank=${bank.bankKey} batch=${i + 1}/${chunks.length} sleepMs=${gapMs}`)
        await this.sleep(gapMs)
      }
      this.logger.log(
        `[TXN_GEMINI_BATCH] bank=${bank.bankKey} batch=${i + 1}/${chunks.length} mails=${chunks[i].length}`,
      )
      const geminiResult = await this.parseGeminiBatch(bank, chunks[i])
      this.logger.log(
        geminiResult.ok
          ? `[TXN_GEMINI_OK] bank=${bank.bankKey} batch=${i + 1}/${chunks.length}`
          : `[TXN_GEMINI_FAIL] bank=${bank.bankKey} batch=${i + 1}/${chunks.length} error=${geminiResult.error} (regex fallback)`,
      )
      for (const message of chunks[i]) {
        maxReceivedAtMs = Math.max(maxReceivedAtMs, message.receivedAtMs)
        const outcome = await this.processMessage({
          tenantId,
          bank,
          message,
          existingKeys,
          dryRun,
          cards,
          geminiResult,
        })
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
    }

    if (!dryRun && maxReceivedAtMs > 0) {
      await this.updateWatermark(bank, maxReceivedAtMs, window.source === 'none' ? 'watermark' : window.source, startDate)
    }

    stats.inserted = inserted
    this.logger.log(
      `[TXN_FOLDER_DONE] bank=${bank.bankKey} inserted=${stats.inserted} dup=${stats.duplicates} miss=${stats.parseMiss} cardMissing=${stats.cardMissing ?? 0} watermark=${maxReceivedAtMs || 'unchanged'}`,
    )
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
    tenantId: string
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
    const existingKeys = await this.getExistingDedupKeys(options.tenantId)
    const cards = await this.loadWalletCards(options.tenantId)
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

      const message = await this.gmailPoll.fetchByMessageId(options.tenantId, failure.messageId)
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

      const outcome = await this.processMessage({
        tenantId: options.tenantId,
        bank,
        message,
        existingKeys,
        dryRun,
        cards,
        retryFailureId: failure.id,
      })
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
    const banks = await this.resolveBanksForRebase(options.bankKeys)
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

  protected sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async parseGeminiBatch(bank: BankConfig, messages: PolledMessage[]): Promise<GeminiTxnBatchResult> {
    const prepared = messages.map((message) => ({
      id: message.id,
      from: message.from,
      subject: message.subject,
      body: this.prepareGeminiBody(message.body),
      receivedAtMs: message.receivedAtMs,
    }))
    try {
      return await this.geminiParser.parseBatch({ issuer: bank.account, messages: prepared })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Gemini parseBatch threw issuer=${bank.account}: ${message}`)
      return { ok: false, error: message }
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

  private parseWithRegex(bank: BankConfig, message: PolledMessage): ParsedBankTransaction | null {
    const parsed = this.parseMessage(bank, message)
    if (!parsed) return null
    parsed.account = bank.account
    parsed.bankKey = bank.bankKey
    return parsed
  }

  private async resolveWindow(bank: BankConfig): Promise<ImportWindow> {
    const labelState = await this.prisma.importJobState.findUnique({
      where: { jobKey_bankKey: { jobKey: JOB_KEY, bankKey: bank.bankKey } },
    })

    if (this.hasWatermark(labelState)) {
      return this.windowFromState(labelState)
    }

    const legacyKey = this.legacyWatermarkKeyFor(bank)
    if (legacyKey) {
      const legacyState = await this.prisma.importJobState.findUnique({
        where: { jobKey_bankKey: { jobKey: JOB_KEY, bankKey: legacyKey } },
      })
      if (this.hasWatermark(legacyState)) {
        return this.windowFromState(legacyState)
      }
    }

    return {
      startDate: null,
      source: 'none',
      watermarkCutoffMs: null,
    }
  }

  private hasWatermark(
    state: { watermarkIso?: string | null; watermarkCutoffMs?: bigint | number | null } | null,
  ): state is { watermarkIso: string; watermarkCutoffMs: bigint | number } {
    return Boolean(state?.watermarkIso && state.watermarkCutoffMs != null)
  }

  private windowFromState(state: { watermarkIso: string; watermarkCutoffMs: bigint | number }): ImportWindow {
    const wm = Number(state.watermarkCutoffMs)
    const buffered = new Date(wm)
    buffered.setDate(buffered.getDate() - 1)
    return {
      startDate: buffered.toISOString().slice(0, 10),
      source: 'watermark',
      watermarkCutoffMs: wm,
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

  private async upsertTransaction(
    row: PersistableTransaction,
    tenantId: string,
  ): Promise<{
    kind: 'inserted' | 'duplicate' | 'card_missing' | 'write_failed'
    txnId?: string
    errorText?: string
  }> {
    const card = await this.prisma.card.findFirst({
      where: { tenantId, cardKey: row.cardKey },
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
          emailSubject: row.emailSubject ?? undefined,
          emailBody: row.emailBody ?? undefined,
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

  private async processMessage(params: {
    tenantId: string
    bank: BankConfig
    message: PolledMessage
    existingKeys: Set<string>
    dryRun: boolean
    cards: WalletCard[]
    geminiResult?: GeminiTxnBatchResult
    retryFailureId?: string
  }): Promise<ProcessOutcome> {
    const { tenantId, bank, message, existingKeys, dryRun, cards, retryFailureId } = params
    try {
      const geminiResult = params.geminiResult ?? (await this.parseGeminiBatch(bank, [message]))
      const parsed = this.resolveParsedTransaction(bank, message, geminiResult)
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

      const issuer = bank.account
      if (!this.findWalletCard(cards, issuer, parsed.cardLast4)) {
        const errorText = `No Wallet card for ${issuer} last4=${parsed.cardLast4}`
        await this.importFailureService.upsertFailure({
          bankKey: bank.bankKey,
          message,
          failureType: 'CARD_NOT_FOUND',
          failureReason: 'card_missing',
          errorText,
        })
        return { kind: 'card_missing', reason: 'card_missing', errorText }
      }

      const dedupeKey = this.makeDedupKey(parsed, issuer)
      if (existingKeys.has(dedupeKey)) {
        return { kind: 'duplicate' }
      }

      existingKeys.add(dedupeKey)
      if (dryRun) {
        return { kind: 'inserted' }
      }

      const write = await this.upsertTransaction(this.toPersistable(parsed, dedupeKey, message, issuer), tenantId)
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
          failureReason: 'card_missing',
          errorText: write.errorText,
        })
        return { kind: 'card_missing', reason: 'card_missing', errorText: write.errorText }
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

  private resolveParsedTransaction(
    bank: BankConfig,
    message: PolledMessage,
    geminiResult: GeminiTxnBatchResult,
  ): ParsedBankTransaction | null {
    const geminiItem = geminiResult.ok ? geminiResult.byMessageId[message.id] : undefined
    if (geminiResult.ok && this.isUsableGeminiItem(geminiItem)) {
      return this.parsedFromGemini(bank, message, geminiItem)
    }
    return this.parseWithRegex(bank, message)
  }

  private isUsableGeminiItem(item: GeminiTxnParse | undefined): item is GeminiTxnParse & { last4: string; amount: number } {
    return Boolean(
      item?.ok &&
        item.last4 &&
        item.amount != null &&
        Number.isFinite(item.amount) &&
        item.amount > 0,
    )
  }

  private parsedFromGemini(
    bank: BankConfig,
    message: PolledMessage,
    item: GeminiTxnParse & { last4: string; amount: number },
  ): ParsedBankTransaction {
    const ts = new Date(message.receivedAtMs).toISOString()
    return {
      txnDate: item.txnDate || ts.slice(0, 10),
      txnTimestamp: ts,
      account: bank.account,
      cardLast4: item.last4,
      amount: item.amount,
      merchant: (item.merchant || `${bank.account} TXN`).trim(),
      channel: item.channel || 'CARD',
      referenceNo: item.referenceNo,
      bankKey: bank.bankKey,
      emailId: message.id,
      importedAt: new Date().toISOString(),
    }
  }

  private toPersistable(
    parsed: ParsedBankTransaction,
    dedupeKey: string,
    message: PolledMessage,
    issuer: string,
  ): PersistableTransaction {
    return {
      txnDate: new Date(parsed.txnDate),
      txnTimestamp: parsed.txnTimestamp ? new Date(parsed.txnTimestamp) : null,
      cardKey: `${issuer.toUpperCase()}_XX${parsed.cardLast4}`,
      amount: parsed.amount,
      merchant: parsed.merchant,
      channel: parsed.channel,
      bankKey: parsed.bankKey,
      emailId: parsed.emailId,
      dedupeKey,
      importedAt: new Date(parsed.importedAt),
      referenceNo: parsed.referenceNo ?? null,
      externalId: null,
      emailSubject: message.subject || null,
      emailBody: message.body || null,
    }
  }

  private makeDedupKey(parsed: ParsedBankTransaction, issuer: string): string {
    const emailId = parsed.emailId.trim()
    if (emailId) return `EMAIL::${emailId}`

    const refNo = (parsed.referenceNo ?? '').trim()
    if (refNo) return `REF::${parsed.bankKey}::${refNo}`

    const card = `${issuer.toUpperCase()}_XX${parsed.cardLast4}`
    const merchant = parsed.merchant.trim().toUpperCase()
    return `FALLBACK::${card}::${parsed.txnTimestamp}::${parsed.amount}::${merchant}`
  }

  private async getExistingDedupKeys(tenantId: string): Promise<Set<string>> {
    const rows = await this.prisma.transaction.findMany({
      where: { tenantId, dedupeKey: { not: null } },
      select: { dedupeKey: true },
      take: 10000,
      orderBy: { createdAt: 'desc' },
    })
    return new Set(rows.map((r) => r.dedupeKey!).filter(Boolean))
  }

  private async loadWalletCards(tenantId: string): Promise<WalletCard[]> {
    return this.prisma.card.findMany({
      where: { tenantId },
      select: { id: true, tenantId: true, cardKey: true, issuer: true, last4: true, status: true },
    })
  }

  private async discoverFolders(tenantId: string, cards: WalletCard[]): Promise<BankConfig[]> {
    const parent = this.labelParent()
    const labels = await this.listChildLabels(tenantId, parent)
    const issuers = new Set(cards.map((card) => card.issuer))
    const folders: BankConfig[] = []
    for (const label of labels) {
      if (!issuers.has(label.leaf)) {
        this.logger.log(`[TXN_SKIP_FOLDER] label="${label.name}" issuer=${label.leaf} (no Wallet match)`)
        continue
      }
      folders.push(this.makeFolderConfig(label.name, label.leaf))
    }
    return folders
  }

  private filterFolders(folders: BankConfig[], bankKeys?: string[]): BankConfig[] {
    if (!bankKeys?.length) return folders
    return folders.filter((folder) => bankKeys.some((key) => this.folderMatchesSelector(folder, key)))
  }

  private folderMatchesSelector(folder: BankConfig, raw: string): boolean {
    const wanted = String(raw ?? '').trim().toUpperCase()
    if (!wanted) return false
    if (
      folder.bankKey.toUpperCase() === wanted ||
      folder.labelName.toUpperCase() === wanted ||
      folder.account.toUpperCase() === wanted
    ) {
      return true
    }
    const legacy = this.legacyWatermarkKeyFor(folder)
    return Boolean(legacy && legacy.toUpperCase() === wanted)
  }

  private async resolveBanksForRebase(bankKeys?: string[]): Promise<BankConfig[]> {
    if (bankKeys?.length) {
      return bankKeys
        .map((key) => this.getBankConfigByKey(key, { preserveKey: LEGACY_BANK_KEYS.has(key) }))
        .filter((bank): bank is BankConfig => Boolean(bank))
    }

    const states = await this.prisma.importJobState.findMany({
      where: { jobKey: JOB_KEY },
      select: { bankKey: true },
    })
    const keys = states
      .map((row) => row.bankKey)
      .filter((key) => key.startsWith(LABEL_KEY_PREFIX) || LEGACY_BANK_KEYS.has(key))

    return keys
      .map((key) => this.getBankConfigByKey(key, { preserveKey: LEGACY_BANK_KEYS.has(key) }))
      .filter((bank): bank is BankConfig => Boolean(bank))
  }

  private getBankConfigByKey(bankKey: string, options?: { preserveKey?: boolean }): BankConfig | null {
    const raw = String(bankKey ?? '').trim()
    if (!raw) return null

    if (raw.toUpperCase().startsWith(LABEL_KEY_PREFIX)) {
      const labelName = raw.slice(LABEL_KEY_PREFIX.length)
      const leaf = labelName.split('/').pop() ?? ''
      if (!leaf) return null
      return this.makeFolderConfig(labelName, leaf)
    }

    const upper = raw.toUpperCase()
    const legacyLeaf = Object.entries(LEGACY_WATERMARK_KEYS).find(([, key]) => key.toUpperCase() === upper)?.[0]
    if (legacyLeaf) {
      const labelName = this.legacyLabelForIssuer(legacyLeaf)
      const config = this.makeFolderConfig(labelName, legacyLeaf)
      return options?.preserveKey ? { ...config, bankKey: raw } : config
    }

    if (raw.includes('/')) {
      const leaf = raw.split('/').pop() ?? ''
      if (!leaf) return null
      return this.makeFolderConfig(raw, leaf)
    }

    return this.makeFolderConfig(`${this.labelParent()}/${raw}`, raw)
  }

  private makeFolderConfig(labelName: string, leaf: string): BankConfig {
    return {
      bankKey: `${LABEL_KEY_PREFIX}${labelName}`,
      account: leaf,
      labelName,
      parserName: this.parserNameForIssuer(leaf),
      fallbackStartDate: this.fallbackStartDate(),
    }
  }

  private parserNameForIssuer(issuer: string): BankParserName | undefined {
    switch (issuer.toUpperCase()) {
      case 'SBI':
        return 'parseSbiTxn'
      case 'HDFC':
        return 'parseHdfcTxn'
      case 'ICICI':
        return 'parseIciciTxn'
      default:
        return undefined
    }
  }

  private legacyWatermarkKeyFor(bank: BankConfig): string | undefined {
    const label = bank.labelName
    if (label === appConfig.importLabelSbi || label === 'CC Transactions/SBI') return LEGACY_WATERMARK_KEYS.SBI
    if (label === appConfig.importLabelHdfc || label === 'CC Transactions/HDFC') return LEGACY_WATERMARK_KEYS.HDFC
    if (label === appConfig.importLabelIcici || label === 'CC Transactions/ICICI') return LEGACY_WATERMARK_KEYS.ICICI
    return LEGACY_WATERMARK_KEYS[bank.account.toUpperCase()]
  }

  private legacyLabelForIssuer(issuer: string): string {
    switch (issuer.toUpperCase()) {
      case 'SBI':
        return appConfig.importLabelSbi || 'CC Transactions/SBI'
      case 'HDFC':
        return appConfig.importLabelHdfc || 'CC Transactions/HDFC'
      case 'ICICI':
        return appConfig.importLabelIcici || 'CC Transactions/ICICI'
      default:
        return `${this.labelParent()}/${issuer}`
    }
  }

  private findWalletCard(cards: WalletCard[], issuer: string, last4: string): WalletCard | undefined {
    const expectedKey = `${issuer}_XX${last4}`.toLowerCase()
    return cards.find((card) => {
      if (card.cardKey.toLowerCase() === expectedKey) return true
      return card.issuer === issuer && card.last4 === last4
    })
  }

  private async listChildLabels(tenantId: string, parentName: string) {
    if (typeof this.gmailPoll.listChildLabels !== 'function') {
      this.logger.warn('GmailPollService.listChildLabels is unavailable; discovering no folders')
      return []
    }
    return this.gmailPoll.listChildLabels(tenantId, parentName)
  }

  private prepareGeminiBody(raw: string): string {
    const maxLen = Number.isFinite(appConfig.importTxnGeminiBodyMaxLen)
      ? Math.max(1, appConfig.importTxnGeminiBodyMaxLen)
      : 4000
    if (typeof this.gmailPoll.prepareGeminiBody === 'function') {
      return this.gmailPoll.prepareGeminiBody(raw, maxLen)
    }
    return String(raw ?? '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen)
  }

  private labelParent(): string {
    return appConfig.importTxnLabelParent || 'CC Transactions'
  }

  private fallbackStartDate(): string {
    return appConfig.importTxnFallbackStartDate || '2026-03-01'
  }

  private geminiBatchSize(): number {
    const size = Number(appConfig.importTxnGeminiBatchSize)
    return Number.isFinite(size) && size > 0 ? size : 5
  }

  private geminiBatchGapMs(): number {
    const gap = Number(appConfig.importTxnGeminiBatchGapMs)
    return Number.isFinite(gap) ? gap : 60000
  }

  private chunkMessages(messages: PolledMessage[], size: number): PolledMessage[][] {
    const chunks: PolledMessage[][] = []
    for (let i = 0; i < messages.length; i += size) {
      chunks.push(messages.slice(i, i + size))
    }
    return chunks
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
