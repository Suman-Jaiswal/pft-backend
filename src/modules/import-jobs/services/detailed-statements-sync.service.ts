import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { google, gmail_v1 } from 'googleapis'
import { appConfig } from '@/config/app.config'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { buildStatementPdfPasswordCandidates } from '@/modules/import-jobs/services/cc-statements-import.service'

type StatementSource = {
  cardKey: string
  labelName: string
  pdfPassword?: string
}

type ParsedTransactions = {
  statement_month: string | null
  transactions: Array<Record<string, unknown>>
}

type SyncResult = {
  cardKey: string
  labelName: string
  messagesScanned: number
  pdfsProcessed: number
  entriesParsed: number
  inserted: number
  updated: number
  failed: number
}

const JOB_KEY = 'detailed_statements_backfill'
const SOURCE_NAME = 'gmail_statement_pdf'
const WATERMARK_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000

const STATEMENT_SOURCES: StatementSource[] = [
  { cardKey: 'SBI_XX5965', labelName: appConfig.statementLabelSbi, pdfPassword: appConfig.statementPdfPasswordSbi || undefined },
  { cardKey: 'HDFC_XX9335', labelName: appConfig.statementLabelHdfc, pdfPassword: appConfig.statementPdfPasswordHdfc || undefined },
  { cardKey: 'ICICI_XX5000', labelName: appConfig.statementLabelIcici5000, pdfPassword: appConfig.statementPdfPasswordIcici5000 || undefined },
  { cardKey: 'ICICI_XX9003', labelName: appConfig.statementLabelIcici9003, pdfPassword: appConfig.statementPdfPasswordIcici9003 || undefined },
  { cardKey: 'CSB_XX4345', labelName: appConfig.statementLabelCsb, pdfPassword: appConfig.statementPdfPasswordCsb || undefined },
  { cardKey: 'SLICE_XX6447', labelName: appConfig.statementLabelSlice, pdfPassword: undefined },
]

@Injectable()
export class DetailedStatementsSyncService {
  private readonly logger = new Logger(DetailedStatementsSyncService.name)

  constructor(private readonly prisma: PrismaService) {}

  async runSync(options: { tenantId: string; cardKeys?: string[]; dryRun?: boolean }) {
    const startedAt = new Date()
    const selected = this.filterSources(options.cardKeys)
    const clientId = appConfig.googleClientId?.trim()
    const clientSecret = appConfig.googleClientSecret?.trim()
    if (!clientId || !clientSecret) throw new Error('reauth_required: google_client_credentials_missing')

    const setting = await this.prisma.pftSetting.findUnique({
      where: { tenantId: options.tenantId },
      select: { importGmailRefreshToken: true },
    })
    const refreshToken = setting?.importGmailRefreshToken?.trim()
    if (!refreshToken) throw new Error('reauth_required: import_gmail_refresh_token_missing')

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, appConfig.importGoogleRedirectUri || undefined)
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    const cards = await this.prisma.card.findMany({
      where: { tenantId: options.tenantId },
      select: { id: true, cardKey: true },
    })
    const cardByKey = new Map(cards.map((c) => [c.cardKey.toUpperCase(), c]))

    const perCard: SyncResult[] = []
    for (const source of selected) {
      const card = cardByKey.get(source.cardKey.toUpperCase())
      if (!card) {
        perCard.push({
          cardKey: source.cardKey,
          labelName: source.labelName,
          messagesScanned: 0,
          pdfsProcessed: 0,
          entriesParsed: 0,
          inserted: 0,
          updated: 0,
          failed: 1,
        })
        continue
      }
      perCard.push(await this.syncSource(gmail, options.tenantId, card.id, source, Boolean(options.dryRun)))
    }

    const aggregate = perCard.reduce(
      (acc, item) => ({
        messagesScanned: acc.messagesScanned + item.messagesScanned,
        pdfsProcessed: acc.pdfsProcessed + item.pdfsProcessed,
        entriesParsed: acc.entriesParsed + item.entriesParsed,
        inserted: acc.inserted + item.inserted,
        updated: acc.updated + item.updated,
        failed: acc.failed + item.failed,
      }),
      { messagesScanned: 0, pdfsProcessed: 0, entriesParsed: 0, inserted: 0, updated: 0, failed: 0 },
    )

    const completedAt = new Date()
    return {
      job: JOB_KEY,
      status: aggregate.failed > 0 ? (aggregate.inserted + aggregate.updated > 0 ? 'PARTIAL' : 'FAILURE') : 'OK',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      elapsedMs: completedAt.getTime() - startedAt.getTime(),
      dryRun: Boolean(options.dryRun),
      aggregate,
      cards: perCard,
    }
  }

  async listMetadata(options: {
    tenantId: string
    cardKeys?: string[]
    fromDate?: string
    toDate?: string
    page?: number
    pageSize?: number
  }) {
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 50
    const where: Prisma.DetailedStatementWhereInput = { tenantId: options.tenantId }
    if (options.cardKeys?.length) {
      where.cardKey = { in: options.cardKeys.map((k) => k.trim().toUpperCase()).filter(Boolean) }
    }
    if (options.fromDate || options.toDate) {
      where.txnDate = {
        gte: options.fromDate ? new Date(`${options.fromDate}T00:00:00.000Z`) : undefined,
        lte: options.toDate ? new Date(`${options.toDate}T23:59:59.999Z`) : undefined,
      }
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.detailedStatement.findMany({
        where,
        orderBy: [{ txnDate: 'desc' }, { gmailInternalMs: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.detailedStatement.count({ where }),
    ])

    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => ({
        id: row.id,
        cardKey: row.cardKey,
        labelName: row.labelName,
        statementMonth: row.statementMonth,
        txnDate: row.txnDate?.toISOString() ?? null,
        amount: row.amount ? Number(row.amount) : null,
        merchant: row.merchant,
        currency: row.currency,
        gmailMessageId: row.gmailMessageId,
        gmailInternalMs: row.gmailInternalMs ? Number(row.gmailInternalMs) : null,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    }
  }

  private filterSources(cardKeys?: string[]): StatementSource[] {
    if (!cardKeys?.length) return STATEMENT_SOURCES
    const wanted = new Set(cardKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))
    return STATEMENT_SOURCES.filter((src) => wanted.has(src.cardKey.toUpperCase()))
  }

  private async syncSource(
    gmail: ReturnType<typeof google.gmail>,
    tenantId: string,
    cardId: string,
    source: StatementSource,
    dryRun: boolean,
  ): Promise<SyncResult> {
    const state = await this.prisma.importJobState.findUnique({
      where: { jobKey_bankKey: { jobKey: JOB_KEY, bankKey: source.cardKey } },
    })
    const cutoffMs = state?.watermarkCutoffMs ? Number(state.watermarkCutoffMs) : 0
    const afterDateYmd = state?.lastStartDate?.trim() ? state.lastStartDate.replace(/-/g, '/') : undefined
    const messageIds = await this.listAllMessageIds(gmail, source.labelName, afterDateYmd)
    let maxSeenInternalMs = cutoffMs

    let pdfsProcessed = 0
    let entriesParsed = 0
    let inserted = 0
    let updated = 0
    let failed = 0

    for (const messageId of messageIds) {
      try {
        const messageResp = await gmail.users.messages.get({
          userId: appConfig.importGmailUser || 'me',
          id: messageId,
          format: 'full',
        })
        const msg = messageResp.data
        const internalMs = Number(msg.internalDate ?? '0')
        if (Number.isFinite(internalMs) && internalMs <= cutoffMs) continue
        if (Number.isFinite(internalMs) && internalMs > maxSeenInternalMs) maxSeenInternalMs = internalMs

        const subject = this.readHeader(msg.payload?.headers, 'subject')
        const body = this.extractBody(msg.payload)
        const attachments = this.listPdfAttachments(msg.payload)

        for (const pdf of attachments) {
          try {
            const attachmentResp = await gmail.users.messages.attachments.get({
              userId: appConfig.importGmailUser || 'me',
              messageId,
              id: pdf.attachmentId,
            })
            const rawData = attachmentResp.data.data
            if (!rawData) continue
            const decrypted = await this.decryptAndExtractPdfText(
              this.decodeBase64UrlToBuffer(rawData),
              source.labelName,
              subject || body,
              source.pdfPassword,
            )
            const parsed = await this.parseTransactionsWithGemini(decrypted, source.labelName, subject)
            const month = parsed.statement_month
            const statement = month
              ? await this.prisma.statement.findFirst({
                  where: { tenantId, cardId, statementMonth: month },
                  select: { id: true },
                })
              : null

            pdfsProcessed++
            for (let idx = 0; idx < parsed.transactions.length; idx++) {
              const entry = parsed.transactions[idx]
              entriesParsed++
              if (dryRun) continue

              const hash = this.entryHash(entry)
              const txnDate =
                this.asDateOrNull(entry.txn_date) ??
                this.asDateOrNull(entry.txnDate) ??
                this.asDateOrNull(entry.date) ??
                this.asDateOrNull(entry.value_date) ??
                null
              const amount =
                this.asNumberOrNull(entry.amount) ??
                this.asNumberOrNull(entry.txn_amount) ??
                this.asNumberOrNull(entry.transaction_amount) ??
                null
              const merchant =
                this.asStringOrNull(entry.merchant) ??
                this.asStringOrNull(entry.description) ??
                this.asStringOrNull(entry.narration) ??
                null
              const currency = this.asStringOrNull(entry.currency) ?? this.asStringOrNull(entry.ccy) ?? 'INR'
              const metadata = this.toInputJsonValue(entry)

              const result = await this.prisma.detailedStatement.upsert({
                where: {
                  tenantId_cardKey_gmailMessageId_entryHash: {
                    tenantId,
                    cardKey: source.cardKey,
                    gmailMessageId: messageId,
                    entryHash: hash,
                  },
                },
                create: {
                  tenantId,
                  cardId,
                  cardKey: source.cardKey,
                  labelName: source.labelName,
                  gmailMessageId: messageId,
                  gmailInternalMs: Number.isFinite(internalMs) ? BigInt(internalMs) : undefined,
                  attachmentId: pdf.attachmentId,
                  statementId: statement?.id,
                  statementMonth: month ?? undefined,
                  entryIndex: idx,
                  entryHash: hash,
                  txnDate: txnDate ?? undefined,
                  amount: amount == null ? undefined : new Prisma.Decimal(amount),
                  merchant: merchant ?? undefined,
                  currency: currency ?? undefined,
                  metadata,
                  createdBy: 'import-job',
                  updatedBy: 'import-job',
                },
                update: {
                  labelName: source.labelName,
                  gmailInternalMs: Number.isFinite(internalMs) ? BigInt(internalMs) : undefined,
                  attachmentId: pdf.attachmentId,
                  statementId: statement?.id,
                  statementMonth: month ?? undefined,
                  entryIndex: idx,
                  txnDate: txnDate ?? undefined,
                  amount: amount == null ? undefined : new Prisma.Decimal(amount),
                  merchant: merchant ?? undefined,
                  currency: currency ?? undefined,
                  metadata,
                  updatedBy: 'import-job',
                },
                select: { createdAt: true, updatedAt: true },
              })
              if (result.createdAt.getTime() === result.updatedAt.getTime()) inserted++
              else updated++
            }
          } catch (error) {
            failed++
            this.logger.warn(
              `[SYNC_PDF_FAIL] card=${source.cardKey} message=${messageId} attachment=${pdf.attachmentId} reason=${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          }
        }
      } catch (error) {
        failed++
        this.logger.warn(
          `[SYNC_MSG_FAIL] card=${source.cardKey} message=${messageId} reason=${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    if (!dryRun && maxSeenInternalMs > cutoffMs) {
      const overlapStart = new Date(Math.max(0, maxSeenInternalMs - WATERMARK_OVERLAP_MS))
      await this.prisma.importJobState.upsert({
        where: { jobKey_bankKey: { jobKey: JOB_KEY, bankKey: source.cardKey } },
        create: {
          jobKey: JOB_KEY,
          bankKey: source.cardKey,
          source: SOURCE_NAME,
          watermarkIso: new Date(maxSeenInternalMs).toISOString(),
          watermarkCutoffMs: BigInt(maxSeenInternalMs),
          lastStartDate: overlapStart.toISOString().slice(0, 10),
        },
        update: {
          source: SOURCE_NAME,
          watermarkIso: new Date(maxSeenInternalMs).toISOString(),
          watermarkCutoffMs: BigInt(maxSeenInternalMs),
          lastStartDate: overlapStart.toISOString().slice(0, 10),
        },
      })
    }

    return {
      cardKey: source.cardKey,
      labelName: source.labelName,
      messagesScanned: messageIds.length,
      pdfsProcessed,
      entriesParsed,
      inserted,
      updated,
      failed,
    }
  }

  private async listAllMessageIds(
    gmail: ReturnType<typeof google.gmail>,
    labelName: string,
    afterDateYmd?: string,
  ): Promise<string[]> {
    const ids: string[] = []
    let pageToken: string | undefined
    const q = afterDateYmd
      ? `label:"${labelName}" has:attachment filename:pdf after:${afterDateYmd}`
      : `label:"${labelName}" has:attachment filename:pdf`
    do {
      const resp = await gmail.users.messages.list({
        userId: appConfig.importGmailUser || 'me',
        q,
        maxResults: 500,
        pageToken,
      })
      const chunk = (resp.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
      ids.push(...chunk)
      pageToken = resp.data.nextPageToken ?? undefined
    } while (pageToken)
    return ids
  }

  private decodeBase64UrlToBuffer(input: string): Buffer {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64')
  }

  private decodeBase64Url(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64').toString('utf8')
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
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

  private readHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, key: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === key.toLowerCase())?.value ?? ''
  }

  private listPdfAttachments(payload: gmail_v1.Schema$MessagePart | undefined): Array<{ attachmentId: string; filename: string }> {
    if (!payload) return []
    const out: Array<{ attachmentId: string; filename: string }> = []
    const stack: gmail_v1.Schema$MessagePart[] = [payload]
    while (stack.length) {
      const part = stack.pop()
      if (!part) continue
      const filename = part.filename ?? ''
      const mime = part.mimeType ?? ''
      if ((mime.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) && part.body?.attachmentId) {
        out.push({ attachmentId: part.body.attachmentId, filename })
      }
      if (part.parts?.length) stack.push(...part.parts)
    }
    return out
  }

  private async decryptAndExtractPdfText(
    pdfBytes: Buffer,
    labelName: string,
    subject: string,
    explicitPassword?: string,
  ): Promise<string> {
    const configured = buildStatementPdfPasswordCandidates(
      labelName,
      subject,
      explicitPassword || appConfig.statementDefaultPdfPassword || undefined,
    )
    const candidates: Array<string | undefined> = [undefined, ...configured]
    const { getDocument, PasswordResponses } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    let lastError: unknown = null

    for (const password of candidates) {
      try {
        const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), password })
        const pdf = await loadingTask.promise
        const textParts: string[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          textParts.push(content.items.map((it) => ('str' in it ? String(it.str) : '')).join(' '))
        }
        await pdf.destroy()
        return textParts.join('\n')
      } catch (error) {
        lastError = error
        const msg = error instanceof Error ? error.message : String(error)
        if (!msg.includes(String(PasswordResponses.NEED_PASSWORD)) && !msg.toLowerCase().includes('password')) continue
      }
    }

    throw new Error(lastError instanceof Error ? lastError.message : String(lastError ?? 'decrypt_failed'))
  }

  private async parseTransactionsWithGemini(extractedText: string, labelName: string, subject: string): Promise<ParsedTransactions> {
    const apiKey = appConfig.statementGeminiApiKey
    if (!apiKey) throw new Error('gemini_not_configured: statementGeminiApiKey missing')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      appConfig.statementGeminiModel,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`

    const prompt = [
      'You extract every transaction row from Indian credit-card statement text.',
      'Return STRICT JSON only in this exact shape:',
      '{"statement_month": "YYYY-MM" | null, "transactions": Array<object>}',
      'Include all row-level metadata you can infer. Use numeric amounts.',
      `Label context: ${labelName}`,
      `Subject context: ${subject}`,
      `Statement text:\n${extractedText.slice(0, 120000)}`,
    ].join('\n')

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const bodyText = await resp.text()
    if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}: ${bodyText}`)

    const parsedRoot = JSON.parse(bodyText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const output = parsedRoot.candidates?.[0]?.content?.parts?.[0]?.text
    if (!output) return { statement_month: null, transactions: [] }

    const parsed = JSON.parse(this.extractJsonObject(output)) as ParsedTransactions
    return {
      statement_month: typeof parsed.statement_month === 'string' ? parsed.statement_month : null,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions.filter((x) => x && typeof x === 'object') : [],
    }
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

  private asDateOrNull(value: unknown): Date | null {
    if (typeof value !== 'string') return null
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }

  private asNumberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const n = Number(value.replace(/,/g, '').replace(/[^\d.-]/g, ''))
      if (Number.isFinite(n)) return n
    }
    return null
  }

  private asStringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private entryHash(entry: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(entry)).digest('hex')
  }

  private toInputJsonValue(entry: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(entry)) as Prisma.InputJsonValue
  }
}
