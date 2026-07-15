import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { appConfig } from '@/config/app.config'
import { google, gmail_v1 } from 'googleapis'
import { ImportErrorCode, StatementImportResult, StatementImportRunSummary, StatementImportSourceConfig } from '@/modules/import-jobs/types/import-contracts'
import { resolveImportErrorCode } from '@/modules/import-jobs/services/import-auth-error.util'

type ParsedStatement = {
  dueDate: string
  minimumAmountDue: number
  totalAmountDue: number
  statementMonth: string
  statementSyncMonth: string
}

type ParsedStatementCandidate = {
  dueDate: string | null
  minimumAmountDue: number | null
  totalAmountDue: number | null
  strategy: string
}

type StatementSource = StatementImportSourceConfig & {
  pdfPassword?: string
}

const REAUTH_REQUIRED_CODE: ImportErrorCode = 'REAUTH_REQUIRED'

const STATEMENT_SOURCES: StatementSource[] = [
  {
    cardKey: 'SBI_XX5965',
    labelName: appConfig.statementLabelSbi,
    flow: 'direct',
    pdfPassword: appConfig.statementPdfPasswordSbi || undefined,
  },
  {
    cardKey: 'HDFC_XX9335',
    labelName: appConfig.statementLabelHdfc,
    flow: 'cloudPdf',
    pdfPassword: appConfig.statementPdfPasswordHdfc || undefined,
  },
  {
    cardKey: 'ICICI_XX5000',
    labelName: appConfig.statementLabelIcici5000,
    flow: 'direct',
    pdfPassword: appConfig.statementPdfPasswordIcici5000 || undefined,
  },
  {
    cardKey: 'ICICI_XX9003',
    labelName: appConfig.statementLabelIcici9003,
    flow: 'direct',
    pdfPassword: appConfig.statementPdfPasswordIcici9003 || undefined,
  },
  {
    cardKey: 'CSB_XX4345',
    labelName: appConfig.statementLabelCsb,
    flow: 'cloudPdf',
    pdfPassword: appConfig.statementPdfPasswordCsb || undefined,
  },
  {
    cardKey: 'SLICE_XX6447',
    labelName: appConfig.statementLabelSlice,
    flow: 'direct',
  },
]

export function buildStatementPdfPasswordCandidates(
  labelName: string,
  subject: string,
  explicitPassword?: string,
): string[] {
  void subject
  const candidates: string[] = []
  if (explicitPassword) candidates.push(explicitPassword)
  const labelLower = (labelName || '').toLowerCase()
  if (labelLower.includes('csb')) {
    const allDigits = labelName.replace(/\D/g, '')
    const last4 = allDigits.length >= 4 ? allDigits.slice(-4) : allDigits
    if (last4) {
      candidates.push(`S${last4.slice(0, 3)}9`)
      candidates.push(last4)
      candidates.push(`S${last4}`)
      candidates.push(`${last4}9`)
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of candidates) {
    const value = item?.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function deriveStatementMonthFromDueDate(dueIsoDate: string): string {
  const [yearRaw, monthRaw] = dueIsoDate.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid due ISO date: ${dueIsoDate}`)
  }
  const derivedYear = month === 1 ? year - 1 : year
  const derivedMonth = month === 1 ? 12 : month - 1
  return `${derivedYear}-${String(derivedMonth).padStart(2, '0')}`
}

export function normalizeStatementAmounts(minimumAmountDue: number, totalAmountDue: number): {
  minimumAmountDue: number
  totalAmountDue: number
} {
  if (minimumAmountDue <= totalAmountDue) {
    return { minimumAmountDue, totalAmountDue }
  }
  return { minimumAmountDue: totalAmountDue, totalAmountDue: minimumAmountDue }
}

@Injectable()
export class CcStatementsImportService {
  private readonly logger = new Logger(CcStatementsImportService.name)

  constructor(private readonly prisma: PrismaService) {}

  async runImport(options: {
    tenantId: string
    dryRun?: boolean
    cardKeys?: string[]
  }): Promise<StatementImportRunSummary> {
    const startedAt = new Date()
    const dryRun = Boolean(options.dryRun)
    const runMonth = this.formatMonth(new Date())
    const selected = this.filterSources(options.cardKeys)
    this.logger.log(
      `[SYNC_START] tenant=${options.tenantId} dryRun=${dryRun} runMonth=${runMonth} selectedCards=${selected
        .map((s) => s.cardKey)
        .join(',')}`,
    )

    const perCard = await Promise.all(selected.map((src) => this.importForSource(src, options.tenantId, dryRun)))

    const aggregate = perCard.reduce(
      (acc, item) => ({
        inserted: acc.inserted + item.inserted,
        updated: acc.updated + item.updated,
        skipped: acc.skipped + item.skipped,
        failed: acc.failed + item.failed,
      }),
      { inserted: 0, updated: 0, skipped: 0, failed: 0 },
    )

    const reauthRequired = perCard.some((r) => r.errorCode === REAUTH_REQUIRED_CODE)
    const status: StatementImportRunSummary['status'] =
      aggregate.failed === 0 ? 'OK' : aggregate.inserted + aggregate.updated > 0 ? 'PARTIAL' : 'FAILURE'
    const completedAt = new Date()
    this.logger.log(
      `[SYNC_DONE] status=${status} inserted=${aggregate.inserted} updated=${aggregate.updated} skipped=${aggregate.skipped} failed=${aggregate.failed} elapsedMs=${completedAt.getTime() - startedAt.getTime()}`,
    )

    return {
      job: 'cc_statements_import',
      status,
      errorCode: reauthRequired ? REAUTH_REQUIRED_CODE : undefined,
      reauthRequired,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      elapsedMs: completedAt.getTime() - startedAt.getTime(),
      runMonth,
      failureCount: aggregate.failed,
      aggregate,
      cards: perCard,
    }
  }

  private filterSources(cardKeys?: string[]): StatementSource[] {
    if (!cardKeys?.length) return STATEMENT_SOURCES
    const wanted = new Set(cardKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))
    return STATEMENT_SOURCES.filter((src) => wanted.has(src.cardKey.toUpperCase()))
  }

  private async importForSource(
    source: StatementSource,
    tenantId: string,
    dryRun: boolean,
  ): Promise<StatementImportResult> {
    try {
      this.logger.log(
        `[SOURCE_START] card=${source.cardKey} label="${source.labelName}" flow=${source.flow} dryRun=${dryRun}`,
      )

      const card = await this.findCardWithCycleDay(tenantId, source.cardKey)
      if (!card) {
        this.logger.error(`[SOURCE_FAIL] card=${source.cardKey} reason=card_not_found`)
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 0,
          failed: 1,
          summary: `Card not found: ${source.cardKey}`,
          error: `Card not found: ${source.cardKey}`,
        }
      }

      const now = new Date()
      const cycleDay = card.statementCycleDay
      if (!cycleDay || cycleDay < 1 || cycleDay > 31) {
        this.logger.warn(`[SOURCE_SKIP] card=${source.cardKey} reason=no_cycle_day_configured`)
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 1,
          failed: 0,
          summary: 'No statement cycle day configured for card',
        }
      }

      const intendedMonth = now.getDate() >= cycleDay
        ? this.formatMonth(now)
        : this.formatPreviousMonth(now)
      this.logger.log(
        `[SOURCE_INTENT] card=${source.cardKey} cycleDay=${cycleDay} intendedMonth=${intendedMonth}`,
      )

      const existingForIntended = await this.prisma.statement.findFirst({
        where: { tenantId, cardId: card.id, statementMonth: intendedMonth },
        select: { id: true, status: true, statementMonth: true },
      })

      if (existingForIntended && /^paid$/i.test((existingForIntended.status ?? '').trim())) {
        this.logger.log(
          `[SOURCE_SKIP] card=${source.cardKey} reason=already_paid statementMonth=${intendedMonth} statementId=${existingForIntended.id}`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 1,
          failed: 0,
          summary: `Statement for ${intendedMonth} already marked PAID`,
          statementMonth: intendedMonth,
        }
      }

      const message = await this.fetchLatestMessageByLabel(tenantId, source.labelName)
      if (!message) {
        this.logger.warn(`[SOURCE_SKIP] card=${source.cardKey} label="${source.labelName}" reason=no_message`)
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 1,
          failed: 0,
          summary: 'No messages under label',
        }
      }

      const syncMonth = this.formatMonth(new Date(message.receivedAtMs))
      this.logger.log(
        `[SOURCE_MESSAGE] card=${source.cardKey} messageId=${message.id} receivedAt=${new Date(message.receivedAtMs).toISOString()} syncMonth=${syncMonth}`,
      )
      this.logVerbose(source.cardKey, 'SOURCE_MESSAGE_FULL', {
        label: source.labelName,
        messageId: message.id,
        subject: message.subject,
        body: message.body,
        payload: message.payload,
      })

      const parsed = source.flow === 'direct'
        ? await this.parseDirectStatement(source.cardKey, source.labelName, message.subject, message.body)
        : await this.parsePdfStatement(tenantId, message, source)
      this.logVerbose(source.cardKey, 'SOURCE_PARSED_RESULT', parsed ?? null)

      if (!parsed) {
        this.logger.warn(
          `[SOURCE_SKIP] card=${source.cardKey} label="${source.labelName}" reason=parse_incomplete`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 1,
          failed: 0,
          summary: 'Parsed statement fields incomplete',
        }
      }

      const existing = await this.prisma.statement.findFirst({
        where: {
          tenantId,
          cardId: card.id,
          statementMonth: parsed.statementMonth,
        },
        select: { id: true, status: true, statementMonth: true },
      })

      if (existing && /^paid$/i.test((existing.status ?? '').trim())) {
        this.logger.log(
          `[SOURCE_SKIP] card=${source.cardKey} reason=parsed_month_already_paid statementMonth=${parsed.statementMonth}`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 1,
          failed: 0,
          summary: `Statement for ${parsed.statementMonth} already marked PAID`,
          statementMonth: parsed.statementMonth,
        }
      }

      const dueMonth = this.formatMonth(new Date(parsed.dueDate))
      const existingLegacyShifted = existing
        ? null
        : await this.prisma.statement.findFirst({
            where: {
              tenantId,
              cardId: card.id,
              statementMonth: dueMonth,
            },
            select: { id: true, status: true, statementMonth: true },
          })

      if (existingLegacyShifted && /^paid$/i.test((existingLegacyShifted.status ?? '').trim())) {
        this.logger.log(
          `[SOURCE_SKIP] card=${source.cardKey} reason=legacy_month_already_paid statementMonth=${dueMonth}`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 0,
          skipped: 1,
          failed: 0,
          summary: `Statement for ${dueMonth} (legacy) already marked PAID`,
          statementMonth: dueMonth,
        }
      }

      const targetRow = existing ?? existingLegacyShifted
      this.logVerbose(source.cardKey, 'SOURCE_DB_DECISION', {
        existingCurrentMonth: existing,
        existingLegacyShifted,
        targetRow,
        intendedMonth,
      })

      if (dryRun) {
        this.logger.log(
          `[SOURCE_DRYRUN] card=${source.cardKey} action=${targetRow ? 'update' : 'insert'} statementMonth=${parsed.statementMonth}`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: targetRow ? 0 : 1,
          updated: targetRow ? 1 : 0,
          skipped: 0,
          failed: 0,
          summary: targetRow ? 'Dry-run update candidate' : 'Dry-run insert candidate',
          statementMonth: parsed.statementMonth,
        }
      }

      if (targetRow) {
        const row = await this.prisma.statement.update({
          where: { id: targetRow.id },
          data: {
            statementMonth: parsed.statementMonth,
            dueDate: new Date(parsed.dueDate),
            minimumAmountDue: parsed.minimumAmountDue,
            totalAmountDue: parsed.totalAmountDue,
            status: 'DUE',
            statementSyncMonth: syncMonth,
            updatedBy: 'import-job',
          },
          select: { id: true },
        })
        this.logger.log(
          `[SOURCE_UPDATE] card=${source.cardKey} statementId=${row.id} fromMonth=${targetRow.statementMonth} toMonth=${parsed.statementMonth}`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 0,
          updated: 1,
          skipped: 0,
          failed: 0,
          summary: 'Updated existing statement',
          statementId: row.id,
          statementMonth: parsed.statementMonth,
        }
      }

      try {
        const row = await this.prisma.statement.create({
          data: {
            tenantId,
            cardId: card.id,
            cardKey: card.cardKey,
            statementMonth: parsed.statementMonth,
            dueDate: new Date(parsed.dueDate),
            minimumAmountDue: parsed.minimumAmountDue,
            totalAmountDue: parsed.totalAmountDue,
            status: 'DUE',
            statementSyncMonth: syncMonth,
            createdBy: 'import-job',
            updatedBy: 'import-job',
          },
          select: { id: true },
        })

        this.logger.log(
          `[SOURCE_INSERT] card=${source.cardKey} statementId=${row.id} statementMonth=${parsed.statementMonth}`,
        )
        return {
          cardKey: source.cardKey,
          labelName: source.labelName,
          flow: source.flow,
          inserted: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          summary: 'Inserted new statement',
          statementId: row.id,
          statementMonth: parsed.statementMonth,
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existingNow = await this.prisma.statement.findFirst({
            where: { tenantId, cardId: card.id, statementMonth: parsed.statementMonth },
            select: { id: true, status: true },
          })
          if (existingNow) {
            if (/^paid$/i.test((existingNow.status ?? '').trim())) {
              this.logger.log(
                `[SOURCE_SKIP] card=${source.cardKey} reason=conflict_row_paid statementMonth=${parsed.statementMonth}`,
              )
              return {
                cardKey: source.cardKey,
                labelName: source.labelName,
                flow: source.flow,
                inserted: 0,
                updated: 0,
                skipped: 1,
                failed: 0,
                summary: `Statement for ${parsed.statementMonth} already marked PAID (conflict recovery)`,
                statementMonth: parsed.statementMonth,
              }
            }
            const row = await this.prisma.statement.update({
              where: { id: existingNow.id },
              data: {
                dueDate: new Date(parsed.dueDate),
                minimumAmountDue: parsed.minimumAmountDue,
                totalAmountDue: parsed.totalAmountDue,
                status: 'DUE',
                statementSyncMonth: syncMonth,
                updatedBy: 'import-job',
              },
              select: { id: true },
            })
            this.logger.log(
              `[SOURCE_UPSERT_RECOVER] card=${source.cardKey} statementId=${row.id} statementMonth=${parsed.statementMonth}`,
            )
            return {
              cardKey: source.cardKey,
              labelName: source.labelName,
              flow: source.flow,
              inserted: 0,
              updated: 1,
              skipped: 0,
              failed: 0,
              summary: 'Updated existing statement after unique conflict',
              statementId: row.id,
              statementMonth: parsed.statementMonth,
            }
          }
        }
        throw error
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const code = resolveImportErrorCode(error)
      this.logger.error(`Statement import failed for ${source.cardKey}: ${msg}`)
      return {
        cardKey: source.cardKey,
        labelName: source.labelName,
        flow: source.flow,
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
        summary: `Failed: ${msg}`,
        errorCode: code,
        error: msg,
      }
    }
  }

  private async fetchLatestMessageByLabel(tenantId: string, labelName: string): Promise<{
    id: string
    subject: string
    body: string
    receivedAtMs: number
    payload: gmail_v1.Schema$MessagePart | undefined
  } | null> {
    const gmail = await this.getGmailClient(tenantId)
    const query = `label:"${labelName}"`
    this.logger.log(`[GMAIL_LIST] label="${labelName}" query=${query}`)
    const list = await gmail.users.messages.list({
      userId: appConfig.importGmailUser || 'me',
      q: query,
      maxResults: 1,
    })
    const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    this.logger.log(`[GMAIL_LIST_RESULT] label="${labelName}" messageCount=${ids.length}`)
    if (!ids.length) return null

    const msg = await gmail.users.messages.get({
      userId: appConfig.importGmailUser || 'me',
      id: ids[0],
      format: 'full',
    })
    const latest = msg.data
    if (!latest?.id) return null
    return {
      id: latest.id,
      subject: this.readHeader(latest.payload?.headers, 'subject'),
      body: this.extractBody(latest.payload),
      receivedAtMs: Number(latest.internalDate ?? '0'),
      payload: latest.payload,
    }
  }

  private async parseDirectStatement(
    cardKey: string,
    labelName: string,
    subject: string,
    body: string,
  ): Promise<ParsedStatement | null> {
    this.logVerbose(cardKey, 'DIRECT_INPUT_FULL', {
      labelName,
      subject,
      body,
    })
    const gemini = await this.parseStatementTextWithGemini(body, labelName, subject)
    if (gemini) {
      this.logger.log(`[DIRECT_GEMINI_PARSE_OK] card=${cardKey}`)
      this.logVerbose(cardKey, 'DIRECT_OUTPUT_FULL', gemini)
      return gemini
    }
    this.logger.warn(
      `[DIRECT_GEMINI_PARSE_MISS] card=${cardKey} subject="${this.compact(subject)}" bodySnippet="${this.compact(body)}"`,
    )
    return null
  }

  private async parsePdfStatement(
    tenantId: string,
    message: { id: string; subject: string; payload: gmail_v1.Schema$MessagePart | undefined },
    source: StatementSource,
  ): Promise<ParsedStatement | null> {
    this.logger.log(`[PDF_FLOW_START] card=${source.cardKey} label="${source.labelName}"`)
    const attachment = this.findFirstPdfAttachment(message.payload)
    if (!attachment?.attachmentId) {
      this.logger.warn(`[PDF_FLOW_SKIP] card=${source.cardKey} reason=no_pdf_attachment`)
      return null
    }

    const gmail = await this.getGmailClient(tenantId)
    const data = await gmail.users.messages.attachments.get({
      userId: appConfig.importGmailUser || 'me',
      messageId: message.id,
      id: attachment.attachmentId,
    })
    const attachmentB64 = data.data.data
    if (!attachmentB64) {
      this.logger.warn(`[PDF_FLOW_SKIP] card=${source.cardKey} reason=empty_attachment_payload`)
      return null
    }
    const pdfBytes = this.decodeBase64UrlToBuffer(attachmentB64)
    const decrypt = await this.decryptAndExtractPdfText(
      pdfBytes,
      source.labelName,
      message.subject,
      source.pdfPassword,
    )
    this.logger.log(
      `[PDF_DECRYPT_OK] card=${source.cardKey} decryptedSize=${decrypt.decryptedSize} passwordUsed=${decrypt.passwordUsedMasked ?? 'none'}`,
    )
    this.logVerbose(source.cardKey, 'PDF_DECRYPT_FULL_TEXT', {
      label: source.labelName,
      subject: message.subject,
      decryptedText: decrypt.text,
    })

    const parsed = await this.parseStatementTextWithGemini(decrypt.text, source.labelName, message.subject)
    if (parsed) {
      this.logger.log(`[PDF_GEMINI_PARSE_OK] card=${source.cardKey}`)
      return parsed
    }
    this.logger.warn(
      `[PDF_GEMINI_PARSE_MISS] card=${source.cardKey} textSnippet="${this.compact(decrypt.text)}"`,
    )
    return null
  }

  private async decryptAndExtractPdfText(
    pdfBytes: Buffer,
    labelName: string,
    subject: string,
    explicitPassword?: string,
  ): Promise<{ text: string; passwordUsedMasked: string | null; decryptedSize: number }> {
    const configured = this.buildPasswordCandidates(
      labelName,
      subject,
      explicitPassword || appConfig.statementDefaultPdfPassword || undefined,
    )
    // Always try without a password first for non-encrypted PDFs.
    const candidates: Array<string | undefined> = [undefined, ...configured]
    const { getDocument, PasswordResponses } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    let lastError: unknown = null
    this.logger.log(
      `[PDF_DECRYPT_START] label="${labelName}" candidates=${candidates.length} blankFirst=true`,
    )

    for (const password of candidates) {
      try {
        this.logger.log(
          `[PDF_DECRYPT_TRY] label="${labelName}" password=${this.maskPassword(password ?? null) ?? 'none'}`,
        )
        const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), password })
        const pdf = await loadingTask.promise
        const textParts: string[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          const part = content.items
            .map((it) => ('str' in it ? String(it.str) : ''))
            .join(' ')
          textParts.push(part)
        }
        await pdf.destroy()
        return {
          text: textParts.join('\n'),
          passwordUsedMasked: this.maskPassword(password ?? null),
          decryptedSize: pdfBytes.length,
        }
      } catch (error) {
        lastError = error
        const msg = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `[PDF_DECRYPT_RETRY] label="${labelName}" password=${this.maskPassword(password ?? null) ?? 'none'} reason=${msg}`,
        )
        if (!msg.includes(String(PasswordResponses.NEED_PASSWORD)) && !msg.toLowerCase().includes('password')) {
          continue
        }
      }
    }

    const lastMessage = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown')
    throw new Error(
      `Failed to decrypt ${labelName}. Tried ${candidates.length} password candidate(s) including blank/default. Last error: ${lastMessage}`,
    )
  }

  private async parseStatementTextWithGemini(
    extractedText: string,
    labelName: string,
    subject: string,
  ): Promise<ParsedStatement | null> {
    const apiKey = appConfig.statementGeminiApiKey
    if (!apiKey) {
      throw new Error('gemini_not_configured: statementGeminiApiKey missing')
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      appConfig.statementGeminiModel,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`

    const prompt = [
      'You are an information extraction engine for Indian credit-card statements.',
      'Return STRICT JSON only with this exact schema (same for all banks):',
      '{"due_date": string | null, "minimum_amount_due": number | null, "total_amount_due": number | null}',
      'Rules:',
      '- Use a single shared schema for ALL cards/banks.',
      '- due_date must be normalized to YYYY-MM-DD.',
      '- minimum_amount_due and total_amount_due must be numeric values (no symbols/commas/text).',
      '- If an amount is marked CR / Credit balance / payable is zero, set total_amount_due=0.',
      '- If minimum due is absent but total due is zero, set minimum_amount_due=0.',
      '- Decode HTML entities (e.g. &#8377;) conceptually before extraction.',
      '- Prefer "Total Amount Due"/"Amount Payable" over unrelated amounts.',
      '- If uncertain, return null for that field.',
      `Label context: ${labelName}`,
      `Subject context: ${subject}`,
      `Statement text:\n${extractedText.slice(0, 120000)}`,
    ].join('\n')
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }
    this.logVerboseFromLabel(labelName, 'GEMINI_PROMPT_FULL', { subject, prompt, payload })

    let bodyText = ''
    for (let attempt = 1; attempt <= appConfig.statementGeminiMaxAttempts; attempt++) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      bodyText = await resp.text()
      this.logVerboseFromLabel(labelName, 'GEMINI_RESPONSE_ATTEMPT', {
        attempt,
        status: resp.status,
        ok: resp.ok,
        bodyText,
      })
      if (resp.ok) break
      const canRetry = [429, 500, 502, 503, 504].includes(resp.status)
      if (!canRetry || attempt === appConfig.statementGeminiMaxAttempts) {
        throw new Error(`Gemini HTTP ${resp.status}: ${bodyText}`)
      }
      const sleep = appConfig.statementGeminiBackoffMs * Math.pow(2, attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, sleep))
    }

    const parsedRoot = JSON.parse(bodyText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const output = parsedRoot.candidates?.[0]?.content?.parts?.[0]?.text
    if (!output) {
      this.logger.warn(`[GEMINI_PARSE_EMPTY] label="${labelName}" subject="${this.compact(subject)}" raw="${this.compact(bodyText)}"`)
      return null
    }

    let obj: {
      due_date?: string | null
      dueDate?: string | null
      minimum_amount_due?: number | null
      minimumAmountDue?: number | null
      total_amount_due?: number | null
      totalAmountDue?: number | null
    }
    try {
      obj = JSON.parse(this.extractJsonObject(output))
    } catch {
      this.logger.warn(
        `[GEMINI_PARSE_JSON_FAIL] label="${labelName}" subject="${this.compact(subject)}" output="${this.compact(output)}"`,
      )
      return null
    }
    this.logVerboseFromLabel(labelName, 'GEMINI_PARSED_OBJECT', obj)
    const dueDate = obj.due_date ?? obj.dueDate ?? null
    const minimum = obj.minimum_amount_due ?? obj.minimumAmountDue ?? null
    const total = obj.total_amount_due ?? obj.totalAmountDue ?? null
    if (!dueDate || minimum == null || total == null) {
      this.logger.warn(
        `[GEMINI_PARSE_INCOMPLETE] label="${labelName}" subject="${this.compact(subject)}" keys="${Object.keys(obj).join(',')}" output="${this.compact(output)}"`,
      )
      return null
    }
    return this.toParsedStatement(String(dueDate), Number(minimum), Number(total))
  }

  private isVerboseCard(cardKey: string): boolean {
    const target = (appConfig.statementSyncVerboseCardKey || '').trim().toUpperCase()
    if (appConfig.statementSyncVerboseLogs) return true
    if (!target) return false
    return cardKey.trim().toUpperCase() === target
  }

  private logVerbose(cardKey: string, step: string, payload: unknown): void {
    if (!this.isVerboseCard(cardKey)) return
    this.logger.log(`[SYNC_VERBOSE] card=${cardKey} step=${step} payload=${this.stringifyForLog(payload)}`)
  }

  private logVerboseFromLabel(labelName: string, step: string, payload: unknown): void {
    const mapping = STATEMENT_SOURCES.find((s) => s.labelName === labelName)
    if (!mapping) return
    this.logVerbose(mapping.cardKey, step, payload)
  }

  private stringifyForLog(value: unknown): string {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private buildPasswordCandidates(labelName: string, subject: string, explicitPassword?: string): string[] {
    return buildStatementPdfPasswordCandidates(labelName, subject, explicitPassword)
  }

  private parseGenericStatement(text: string, subject: string): ParsedStatement | null {
    const csb = this.parseCsbPdfStatement(text)
    if (csb) return csb
    const candidate = this.extractGenericCandidate(text, subject)
    if (this.getMissingFields(candidate).length) return null
    return this.toParsedStatement(
      candidate.dueDate as string,
      candidate.minimumAmountDue as number,
      candidate.totalAmountDue as number,
    )
  }

  private extractDirectCandidate(cardKey: string, body: string, subject: string): ParsedStatementCandidate {
    if (cardKey.startsWith('SBI_')) {
      return {
        strategy: 'sbi_direct',
        totalAmountDue: this.extractAmountAny(body, [
          /Total amount due\s*\(?[^\d₹]*₹?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Total Amount Due\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Amount Due\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2}|[\d,]+)/i,
        ]),
        minimumAmountDue: this.extractAmountAny(body, [
          /Minimum amount due\s*\(?[^\d₹]*₹?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Minimum Amount Due\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Min(?:imum)?\s+Due\s*[:\-]?\s*₹?\s*([\d,]+\.\d{2}|[\d,]+)/i,
        ]),
        dueDate: this.extractDateAny(`${body}\n${subject}`, [
          { regex: /Payment due date\s*[:\-]?\s*([0-9]{2}-[A-Za-z]{3}-[0-9]{4})/i, hint: 'DD-MMM-YYYY' },
          { regex: /Due date\s*[:\-]?\s*([0-9]{2}-[A-Za-z]{3}-[0-9]{4})/i, hint: 'DD-MMM-YYYY' },
          { regex: /Payment due by\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i, hint: 'MMMM D, YYYY' },
        ]),
      }
    }

    if (cardKey.startsWith('ICICI_')) {
      return {
        strategy: 'icici_direct',
        dueDate: this.extractDateAny(`${body}\n${subject}`, [
          { regex: /Payment due by\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i, hint: 'MMMM D, YYYY' },
          { regex: /Due date\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i, hint: 'MMMM D, YYYY' },
          { regex: /Due Date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i, hint: 'AUTO' },
        ]),
        minimumAmountDue: this.extractAmountAny(body, [
          /Minimum Amount Due\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Min(?:imum)?\s+Amount\s+Due\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Minimum amount to be paid\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
        ]),
        totalAmountDue: this.extractAmountAny(body, [
          /Total Amount Due\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Total Amt Due\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Total due\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
          /Amount payable\s*[:\-]?\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
        ]),
      }
    }

    const generic = this.extractGenericCandidate(body, subject)
    return { ...generic, strategy: 'generic_direct' }
  }

  private extractGenericCandidate(text: string, subject: string): ParsedStatementCandidate {
    return {
      strategy: 'generic',
      totalAmountDue: this.extractAmountAny(text, [
        /(?:total(?:\s+amount)?\s+due)\s*[:\-]?\s*(?:₹|Rs\.?|INR|C)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
        /(?:amount\s+due)\s*[:\-]?\s*(?:₹|Rs\.?|INR|C)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
      ]),
      minimumAmountDue: this.extractAmountAny(text, [
        /(?:minimum(?:\s+amount)?\s+due)\s*[:\-]?\s*(?:₹|Rs\.?|INR|C)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
        /(?:min(?:imum)?\s+due)\s*[:\-]?\s*(?:₹|Rs\.?|INR|C)?\s*([\d,]+\.\d{2}|[\d,]+)/i,
      ]),
      dueDate: this.extractDateAny(`${text}\n${subject}`, [
        {
          regex:
            /(?:payment\s+due(?:\s+date)?|payment\s+due\s+by|due\s+date|due\s+by)\s*[:\-]?\s*([0-9]{2}-[A-Za-z]{3}-[0-9]{4}|[0-9]{1,2}\s+[A-Za-z]{3},\s+[0-9]{4}|[A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
          hint: 'AUTO',
        },
      ]),
    }
  }

  private parseCsbPdfStatement(text: string): ParsedStatement | null {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return null

    // CSB PDF commonly contains a compact summary sequence:
    // "Rs. 12,337.73 01 Jun 2026 Rs. 500.00 17/05/2026 ..."
    const seq = normalized.match(
      /Rs\.?\s*([\d,]+\.\d{2}|[\d,]+)\s+([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})\s+Rs\.?\s*([\d,]+\.\d{2}|[\d,]+)/i,
    )
    if (seq?.[1] && seq?.[2] && seq?.[3]) {
      return this.toParsedStatement(seq[2], Number(seq[3].replace(/,/g, '')), Number(seq[1].replace(/,/g, '')))
    }

    const dueDate = this.extractDateAny(normalized, [
      { regex: /([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})/, hint: 'AUTO' },
      { regex: /([0-9]{1,2}\/[0-9]{2}\/[0-9]{4})/, hint: 'AUTO' },
    ])
    const totals = [...normalized.matchAll(/Rs\.?\s*([\d,]+\.\d{2}|[\d,]+)/gi)]
      .map((m) => Number(String(m[1]).replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!dueDate || totals.length < 2) return null
    const sorted = [...totals].sort((a, b) => a - b)
    return this.toParsedStatement(dueDate, sorted[0], sorted[sorted.length - 1])
  }

  private extractAmountAny(text: string, regexes: RegExp[]): number | null {
    for (const regex of regexes) {
      const value = this.extractAmount(text, regex)
      if (value != null) return value
    }
    return null
  }

  private extractDateAny(
    text: string,
    patterns: Array<{ regex: RegExp; hint: 'DD-MMM-YYYY' | 'MMMM D, YYYY' | 'AUTO' }>,
  ): string | null {
    for (const p of patterns) {
      const value = this.extractDate(text, p.regex, p.hint)
      if (value) return value
    }
    return null
  }

  private getMissingFields(candidate: ParsedStatementCandidate): string[] {
    const missing: string[] = []
    if (!candidate.dueDate) missing.push('dueDate')
    if (candidate.minimumAmountDue == null) missing.push('minimumAmountDue')
    if (candidate.totalAmountDue == null) missing.push('totalAmountDue')
    return missing
  }

  private compact(input: string, max = 180): string {
    const normalized = input.replace(/\s+/g, ' ').trim()
    if (normalized.length <= max) return normalized
    return `${normalized.slice(0, max)}...`
  }

  private toParsedStatement(dueDate: string, minimumAmountDue: number, totalAmountDue: number): ParsedStatement {
    const dueIso = this.toIsoDate(dueDate)
    const normalized = normalizeStatementAmounts(minimumAmountDue, totalAmountDue)
    const statementMonth = deriveStatementMonthFromDueDate(dueIso)
    return {
      dueDate: dueIso,
      minimumAmountDue: normalized.minimumAmountDue,
      totalAmountDue: normalized.totalAmountDue,
      statementMonth,
      statementSyncMonth: statementMonth,
    }
  }

  private extractAmount(text: string, regex: RegExp): number | null {
    const match = text.match(regex)
    if (!match?.[1]) return null
    const num = Number(String(match[1]).replace(/,/g, ''))
    return Number.isFinite(num) ? num : null
  }

  private async findCardWithCycleDay(
    tenantId: string,
    sourceCardKey: string,
  ): Promise<{ id: string; cardKey: string; statementCycleDay: number | null } | null> {
    const exact = await this.prisma.card.findFirst({
      where: { tenantId, cardKey: { equals: sourceCardKey, mode: 'insensitive' } },
      select: { id: true, cardKey: true, statementCycleDay: true },
    })
    if (exact) return exact

    const sourceDigits = this.last4(sourceCardKey)
    if (!sourceDigits) return null
    const cards = await this.prisma.card.findMany({
      where: { tenantId },
      select: { id: true, cardKey: true, statementCycleDay: true },
    })
    return cards.find((c) => this.last4(c.cardKey) === sourceDigits) ?? null
  }

  private last4(key: string): string | null {
    const digits = key.replace(/\D/g, '')
    if (digits.length < 4) return null
    return digits.slice(-4)
  }

  private extractDate(text: string, regex: RegExp, formatHint: 'DD-MMM-YYYY' | 'MMMM D, YYYY' | 'AUTO'): string | null {
    const match = text.match(regex)
    if (!match?.[1]) return null
    const raw = match[1].trim()
    if (formatHint === 'DD-MMM-YYYY') {
      const [d, mon, y] = raw.split('-')
      const map: Record<string, string> = {
        Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
        Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
      }
      const month = map[mon]
      if (!month) return null
      return `${y}-${month}-${d}`
    }
    if (formatHint === 'MMMM D, YYYY') {
      const parsed = new Date(raw)
      if (Number.isNaN(parsed.getTime())) return null
      return this.toIsoDate(parsed.toISOString().slice(0, 10))
    }
    return this.toIsoDate(raw)
  }

  private toIsoDate(input: string): string {
    const trimmed = input.trim()
    const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (dmy) {
      const day = Number(dmy[1])
      const month = Number(dmy[2])
      const year = Number(dmy[3])
      if (year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      }
    }
    const d = new Date(input)
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid due date: ${input}`)
    return d.toISOString().slice(0, 10)
  }

  private formatMonth(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }

  private formatPreviousMonth(date: Date): string {
    const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1)
    return this.formatMonth(prev)
  }

  private async getGmailClient(tenantId: string) {
    const clientId = appConfig.googleClientId
    const clientSecret = appConfig.googleClientSecret
    if (!clientId || !clientSecret) {
      throw new Error('reauth_required: google_client_credentials_missing')
    }
    const setting = await this.prisma.pftSetting.findUnique({
      where: { tenantId },
      select: { importGmailRefreshToken: true },
    })
    const refreshToken = setting?.importGmailRefreshToken?.trim()
    if (!refreshToken) throw new Error('reauth_required: import_gmail_refresh_token_missing')
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, appConfig.importGoogleRedirectUri || undefined)
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
  }

  private readHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, key: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === key.toLowerCase())?.value ?? ''
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return ''
    const direct = payload.body?.data ? this.decodeHtmlEntities(this.decodeBase64Url(payload.body.data)) : ''
    if (direct) return direct
    for (const part of payload.parts ?? []) {
      if (part?.mimeType === 'text/plain' && part.body?.data) return this.decodeHtmlEntities(this.decodeBase64Url(part.body.data))
    }
    for (const part of payload.parts ?? []) {
      if (part?.mimeType === 'text/html' && part.body?.data) return this.stripHtml(this.decodeHtmlEntities(this.decodeBase64Url(part.body.data)))
    }
    for (const part of payload.parts ?? []) {
      const nested = this.extractBody(part)
      if (nested) return nested
    }
    return ''
  }

  private findFirstPdfAttachment(payload: gmail_v1.Schema$MessagePart | undefined): { attachmentId?: string } | null {
    if (!payload) return null
    const stack: gmail_v1.Schema$MessagePart[] = [payload]
    while (stack.length) {
      const part = stack.pop()
      if (!part) continue
      const filename = part.filename ?? ''
      const mime = part.mimeType ?? ''
      if ((mime.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) && part.body?.attachmentId) {
        return { attachmentId: part.body.attachmentId }
      }
      if (part.parts?.length) stack.push(...part.parts)
    }
    return null
  }

  private decodeBase64Url(data: string): string {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64').toString('utf8')
  }

  private decodeBase64UrlToBuffer(data: string): Buffer {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64')
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private maskPassword(password: string | null): string | null {
    if (!password) return null
    if (password.length < 2) return '***'
    return `${password.slice(0, 1)}***${password.slice(-1)}`
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  }

  private extractJsonObject(text: string): string {
    const raw = text.trim()
    if (raw.startsWith('{') && raw.endsWith('}')) return raw
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (fenced?.[1]) return fenced[1].trim()
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first >= 0 && last > first) return raw.slice(first, last + 1)
    return raw
  }
}