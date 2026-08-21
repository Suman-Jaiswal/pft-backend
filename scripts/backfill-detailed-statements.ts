import 'reflect-metadata'
import * as dotenv from 'dotenv'
dotenv.config()

import { createHash } from 'crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { google, gmail_v1 } from 'googleapis'
import { appConfig } from '@/config/app.config'
import { buildStatementPdfPasswordCandidates } from '@/modules/import-jobs/services/cc-statements-import.service'

const prisma = new PrismaClient()
const JOB_KEY = 'detailed_statements_backfill'
const SOURCE_NAME = 'gmail_statement_pdf'
const WATERMARK_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000

type StatementSource = {
  cardKey: string
  labelName: string
  pdfPassword?: string
}

type ParsedTransactions = {
  statement_month: string | null
  transactions: Array<Record<string, unknown>>
}

const STATEMENT_SOURCES: StatementSource[] = [
  { cardKey: 'SBI_XX5965', labelName: appConfig.statementLabelSbi, pdfPassword: appConfig.statementPdfPasswordSbi || undefined },
  { cardKey: 'HDFC_XX9335', labelName: appConfig.statementLabelHdfc, pdfPassword: appConfig.statementPdfPasswordHdfc || undefined },
  { cardKey: 'ICICI_XX5000', labelName: appConfig.statementLabelIcici5000, pdfPassword: appConfig.statementPdfPasswordIcici5000 || undefined },
  { cardKey: 'ICICI_XX9003', labelName: appConfig.statementLabelIcici9003, pdfPassword: appConfig.statementPdfPasswordIcici9003 || undefined },
  { cardKey: 'CSB_XX4345', labelName: appConfig.statementLabelCsb, pdfPassword: appConfig.statementPdfPasswordCsb || undefined },
  { cardKey: 'SLICE_XX6447', labelName: appConfig.statementLabelSlice, pdfPassword: undefined },
]

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function decodeBase64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return ''
  const direct = payload.body?.data ? decodeHtmlEntities(decodeBase64Url(payload.body.data)) : ''
  if (direct) return direct
  for (const part of payload.parts ?? []) {
    if (part?.mimeType === 'text/plain' && part.body?.data) return decodeHtmlEntities(decodeBase64Url(part.body.data))
  }
  for (const part of payload.parts ?? []) {
    if (part?.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeHtmlEntities(decodeBase64Url(part.body.data)))
  }
  for (const part of payload.parts ?? []) {
    const nested = extractBody(part)
    if (nested) return nested
  }
  return ''
}

function readHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, key: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === key.toLowerCase())?.value ?? ''
}

function listPdfAttachments(payload: gmail_v1.Schema$MessagePart | undefined): Array<{ attachmentId: string; filename: string }> {
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

function maskPassword(password: string | null): string | null {
  if (!password) return null
  if (password.length < 2) return '***'
  return `${password.slice(0, 1)}***${password.slice(-1)}`
}

async function decryptAndExtractPdfText(
  pdfBytes: Buffer,
  labelName: string,
  subject: string,
  explicitPassword?: string,
): Promise<{ text: string; passwordUsedMasked: string | null }> {
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
        const part = content.items.map((it) => ('str' in it ? String(it.str) : '')).join(' ')
        textParts.push(part)
      }
      await pdf.destroy()
      return { text: textParts.join('\n'), passwordUsedMasked: maskPassword(password ?? null) }
    } catch (error) {
      lastError = error
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes(String(PasswordResponses.NEED_PASSWORD)) && !msg.toLowerCase().includes('password')) {
        continue
      }
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown')
  throw new Error(`Failed to decrypt ${labelName}. Last error: ${lastMessage}`)
}

function extractJsonObject(text: string): string {
  const raw = text.trim()
  if (raw.startsWith('{') && raw.endsWith('}')) return raw
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) return raw.slice(first, last + 1)
  return raw
}

async function parseTransactionsWithGemini(extractedText: string, labelName: string, subject: string): Promise<ParsedTransactions> {
  const apiKey = appConfig.statementGeminiApiKey
  if (!apiKey) {
    throw new Error('Missing STATEMENT_GEMINI_API_KEY for transaction extraction')
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    appConfig.statementGeminiModel,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`

  const prompt = [
    'You extract every transaction row from Indian credit-card statement text.',
    'Return STRICT JSON only in this exact shape:',
    '{"statement_month": "YYYY-MM" | null, "transactions": Array<object>}',
    'Rules:',
    '- Include ALL transaction rows visible in statement text.',
    '- Keep each transaction object rich: preserve all metadata keys you can infer (date, value_date, amount, currency, merchant, description, reference_no, txn_type, location, dr_cr, etc).',
    '- Normalize date strings to YYYY-MM-DD when possible, otherwise keep original as a string field and add a null normalized field.',
    '- Keep numeric amounts as numbers (no commas/currency symbols).',
    '- Do not invent transactions; if nothing is found, return empty array.',
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

  const parsedRoot = JSON.parse(bodyText) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const output = parsedRoot.candidates?.[0]?.content?.parts?.[0]?.text
  if (!output) return { statement_month: null, transactions: [] }

  const parsed = JSON.parse(extractJsonObject(output)) as ParsedTransactions
  const txns = Array.isArray(parsed.transactions) ? parsed.transactions : []
  return {
    statement_month: typeof parsed.statement_month === 'string' ? parsed.statement_month : null,
    transactions: txns.filter((item) => item && typeof item === 'object'),
  }
}

function asDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '')
    if (!normalized) return null
    const n = Number(normalized)
    if (Number.isFinite(n)) return n
  }
  return null
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function entryHash(entry: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(entry)).digest('hex')
}

function toInputJsonValue(entry: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(entry)) as Prisma.InputJsonValue
}

function toAfterDateYmd(input: Date): string {
  const y = input.getUTCFullYear()
  const m = String(input.getUTCMonth() + 1).padStart(2, '0')
  const d = String(input.getUTCDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

async function listAllMessageIds(
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

async function main(): Promise<void> {
  const tenantIdFromEnv = process.env.TENANT_ID?.trim()
  const clientId = required('GOOGLE_CLIENT_ID')
  const clientSecret = required('GOOGLE_CLIENT_SECRET')

  const setting = tenantIdFromEnv
    ? await prisma.pftSetting.findUnique({
        where: { tenantId: tenantIdFromEnv },
        select: { tenantId: true, importGmailRefreshToken: true },
      })
    : await prisma.pftSetting.findFirst({
        where: { importGmailRefreshToken: { not: null } },
        select: { tenantId: true, importGmailRefreshToken: true },
      })

  if (!setting?.tenantId || !setting.importGmailRefreshToken) {
    throw new Error('No tenant with import Gmail refresh token found. Set TENANT_ID explicitly if needed.')
  }

  const tenantId = setting.tenantId
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, appConfig.importGoogleRedirectUri || undefined)
  oauth2Client.setCredentials({ refresh_token: setting.importGmailRefreshToken })
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const cardRows = await prisma.card.findMany({
    where: { tenantId },
    select: { id: true, cardKey: true },
  })
  const cardByKey = new Map(cardRows.map((c) => [c.cardKey.toUpperCase(), c]))

  let totalMessages = 0
  let totalPdfs = 0
  let totalEntries = 0
  let inserted = 0
  let updated = 0
  let failed = 0

  console.log(`Starting detailed statement backfill for tenant=${tenantId}`)

  for (const source of STATEMENT_SOURCES) {
    const card = cardByKey.get(source.cardKey.toUpperCase())
    if (!card) {
      console.log(`[SKIP_CARD] card=${source.cardKey} reason=card_not_found`)
      continue
    }

    const state = await prisma.importJobState.findUnique({
      where: {
        jobKey_bankKey: {
          jobKey: JOB_KEY,
          bankKey: source.cardKey,
        },
      },
    })
    const cutoffMs = state?.watermarkCutoffMs ? Number(state.watermarkCutoffMs) : 0
    const afterDateYmd = state?.lastStartDate?.trim()
      ? state.lastStartDate.replace(/-/g, '/')
      : undefined
    const messageIds = await listAllMessageIds(gmail, source.labelName, afterDateYmd)
    console.log(
      `[LABEL_SCAN] label="${source.labelName}" messages=${messageIds.length} after=${afterDateYmd ?? 'ALL'} cutoffMs=${cutoffMs || 0}`,
    )
    totalMessages += messageIds.length
    let maxSeenInternalMs = cutoffMs

    for (const messageId of messageIds) {
      try {
        const messageResp = await gmail.users.messages.get({
          userId: appConfig.importGmailUser || 'me',
          id: messageId,
          format: 'full',
        })
        const msg = messageResp.data
        const internalMs = Number(msg.internalDate ?? '0')
        if (Number.isFinite(internalMs) && internalMs <= cutoffMs) {
          continue
        }
        if (Number.isFinite(internalMs) && internalMs > maxSeenInternalMs) {
          maxSeenInternalMs = internalMs
        }
        const subject = readHeader(msg.payload?.headers, 'subject')
        const body = extractBody(msg.payload)
        const attachments = listPdfAttachments(msg.payload)

        if (!attachments.length) continue
        totalPdfs += attachments.length

        for (const pdf of attachments) {
          try {
            const attachmentResp = await gmail.users.messages.attachments.get({
              userId: appConfig.importGmailUser || 'me',
              messageId,
              id: pdf.attachmentId,
            })
            const rawData = attachmentResp.data.data
            if (!rawData) continue

            const pdfBytes = decodeBase64UrlToBuffer(rawData)
            const decrypted = await decryptAndExtractPdfText(pdfBytes, source.labelName, subject || body, source.pdfPassword)
            const parsed = await parseTransactionsWithGemini(decrypted.text, source.labelName, subject)
            const month = parsed.statement_month
            const statement = month
              ? await prisma.statement.findFirst({
                  where: { tenantId, cardId: card.id, statementMonth: month },
                  select: { id: true },
                })
              : null

            for (let index = 0; index < parsed.transactions.length; index++) {
              const entry = parsed.transactions[index] as Record<string, unknown>
              const hash = entryHash(entry)
              totalEntries++

              const txnDate =
                asDateOrNull(entry.txn_date) ??
                asDateOrNull(entry.txnDate) ??
                asDateOrNull(entry.date) ??
                asDateOrNull(entry.value_date) ??
                null
              const amount =
                asNumberOrNull(entry.amount) ??
                asNumberOrNull(entry.txn_amount) ??
                asNumberOrNull(entry.transaction_amount) ??
                null
              const merchant =
                asStringOrNull(entry.merchant) ??
                asStringOrNull(entry.description) ??
                asStringOrNull(entry.narration) ??
                null
              const currency =
                asStringOrNull(entry.currency) ??
                asStringOrNull(entry.ccy) ??
                'INR'
              const metadata = toInputJsonValue(entry)

              const result = await prisma.detailedStatement.upsert({
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
                  cardId: card.id,
                  cardKey: source.cardKey,
                  labelName: source.labelName,
                  gmailMessageId: messageId,
                  gmailInternalMs: Number.isFinite(internalMs) ? BigInt(internalMs) : undefined,
                  attachmentId: pdf.attachmentId,
                  statementId: statement?.id,
                  statementMonth: month ?? undefined,
                  entryIndex: index,
                  entryHash: hash,
                  txnDate: txnDate ?? undefined,
                  amount: amount == null ? undefined : new Prisma.Decimal(amount),
                  merchant: merchant ?? undefined,
                  currency: currency ?? undefined,
                  metadata,
                  createdBy: 'one-time-script',
                  updatedBy: 'one-time-script',
                },
                update: {
                  labelName: source.labelName,
                  gmailInternalMs: Number.isFinite(internalMs) ? BigInt(internalMs) : undefined,
                  attachmentId: pdf.attachmentId,
                  statementId: statement?.id,
                  statementMonth: month ?? undefined,
                  entryIndex: index,
                  txnDate: txnDate ?? undefined,
                  amount: amount == null ? undefined : new Prisma.Decimal(amount),
                  merchant: merchant ?? undefined,
                  currency: currency ?? undefined,
                  metadata,
                  updatedBy: 'one-time-script',
                },
                select: { id: true, createdAt: true, updatedAt: true },
              })

              if (result.createdAt.getTime() === result.updatedAt.getTime()) inserted++
              else updated++
            }

            console.log(
              `[PDF_OK] label="${source.labelName}" message=${messageId} attachment="${pdf.filename || pdf.attachmentId}" entries=${parsed.transactions.length} password=${decrypted.passwordUsedMasked ?? 'none'}`,
            )
          } catch (error) {
            failed++
            const msgText = error instanceof Error ? error.message : String(error)
            console.log(
              `[PDF_FAIL] label="${source.labelName}" message=${messageId} attachment=${pdf.attachmentId} reason=${msgText}`,
            )
          }
        }
      } catch (error) {
        failed++
        const msgText = error instanceof Error ? error.message : String(error)
        console.log(`[MSG_FAIL] label="${source.labelName}" message=${messageId} reason=${msgText}`)
      }
    }

    if (maxSeenInternalMs > cutoffMs) {
      const overlapStart = new Date(Math.max(0, maxSeenInternalMs - WATERMARK_OVERLAP_MS))
      await prisma.importJobState.upsert({
        where: {
          jobKey_bankKey: {
            jobKey: JOB_KEY,
            bankKey: source.cardKey,
          },
        },
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
      console.log(
        `[WATERMARK_UPDATE] card=${source.cardKey} watermarkIso=${new Date(maxSeenInternalMs).toISOString()} nextAfter=${toAfterDateYmd(overlapStart)}`,
      )
    }
  }

  console.log('')
  console.log('Backfill complete:')
  console.log(`  Tenant: ${tenantId}`)
  console.log(`  Messages scanned: ${totalMessages}`)
  console.log(`  PDFs processed: ${totalPdfs}`)
  console.log(`  Entry rows parsed: ${totalEntries}`)
  console.log(`  Rows inserted: ${inserted}`)
  console.log(`  Rows updated: ${updated}`)
  console.log(`  Failures: ${failed}`)
}

main()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
