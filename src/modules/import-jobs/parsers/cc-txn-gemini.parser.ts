import { Injectable, Logger } from '@nestjs/common'
import { appConfig } from '@/config/app.config'

export type GeminiTxnParse = {
  ok: boolean
  last4?: string
  amount?: number
  txnDate?: string
  merchant?: string
  referenceNo?: string
  channel?: string
  skipReason?: string
}

export type GeminiTxnBatchResult =
  | { ok: true; byMessageId: Record<string, GeminiTxnParse> }
  | { ok: false; error: string }

export type GeminiTxnBatchInput = {
  issuer: string
  messages: Array<{
    id: string
    from: string
    subject: string
    body: string
    receivedAtMs: number
  }>
}

type GeminiRawItem = {
  gmailMessageId?: unknown
  ok?: unknown
  last4?: unknown
  amount?: unknown
  txnDate?: unknown
  merchant?: unknown
  referenceNo?: unknown
  channel?: unknown
  skipReason?: unknown
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export function stripToFourDigits(raw: unknown): string | undefined {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 4) return undefined
  return digits.slice(-4)
}

export function mapGeminiItemsToById(items: unknown, expectedIds: string[]): Record<string, GeminiTxnParse> {
  const list = Array.isArray(items) ? items : []
  const byId = new Map<string, GeminiRawItem>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as GeminiRawItem
    const id = String(row.gmailMessageId ?? '').trim()
    if (id) byId.set(id, row)
  }

  const result: Record<string, GeminiTxnParse> = {}
  for (const id of expectedIds) {
    const row = byId.get(id)
    if (!row) {
      result[id] = { ok: false, skipReason: 'missing_from_model' }
      continue
    }
    result[id] = normalizeGeminiItem(row)
  }
  return result
}

function normalizeGeminiItem(row: GeminiRawItem): GeminiTxnParse {
  const last4 = stripToFourDigits(row.last4)
  const amount = coerceAmount(row.amount)
  const txnDate = coerceIsoDate(row.txnDate)
  const skipReason = typeof row.skipReason === 'string' && row.skipReason.trim() ? row.skipReason.trim() : undefined
  const explicitSkip = row.ok === false || row.ok === 'false'
  const ok = !explicitSkip && Boolean(last4) && amount != null && amount > 0

  if (!ok) {
    return {
      ok: false,
      last4,
      amount,
      txnDate,
      merchant: coerceOptionalString(row.merchant),
      referenceNo: coerceOptionalString(row.referenceNo),
      channel: coerceOptionalString(row.channel),
      skipReason: skipReason || (explicitSkip ? 'not_a_txn' : 'gemini_incomplete'),
    }
  }

  return {
    ok: true,
    last4,
    amount,
    txnDate,
    merchant: coerceOptionalString(row.merchant),
    referenceNo: coerceOptionalString(row.referenceNo),
    channel: coerceOptionalString(row.channel),
  }
}

function coerceAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, '').trim())
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function coerceIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1]
}

function coerceOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

@Injectable()
export class CcTxnGeminiParser {
  private readonly logger = new Logger(CcTxnGeminiParser.name)

  async parseBatch(input: GeminiTxnBatchInput): Promise<GeminiTxnBatchResult> {
    const apiKey = appConfig.statementGeminiApiKey
    if (!apiKey) {
      return { ok: false, error: 'gemini_not_configured: statementGeminiApiKey missing' }
    }

    const expectedIds = input.messages.map((m) => m.id)
    const model = appConfig.statementGeminiModel
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`

    const prompt = [
      'You extract posted Indian credit-card alert transactions from emails.',
      'Indian credit-card alerts only. Ignore OTPs, one-time passwords, login alerts, promotional mail, and monthly statements.',
      `Issuer / folder context: ${input.issuer}`,
      'Return STRICT JSON: an array with the same length and order as the input emails.',
      'Each item MUST include gmailMessageId matching the input message id.',
      'Each item schema:',
      '{"gmailMessageId": string, "ok": boolean, "last4": string | null, "amount": number | null, "txnDate": "YYYY-MM-DD" | null, "merchant": string | null, "referenceNo": string | null, "channel": string | null, "skipReason": string | null}',
      'Rules:',
      '- last4 is the 4-digit card suffix.',
      '- amount is a positive number (no currency symbols).',
      '- txnDate is YYYY-MM-DD when present; else null.',
      '- If the email is not a posted card spend, set ok=false and skipReason.',
      'Emails:',
      JSON.stringify(
        input.messages.map((m) => ({
          gmailMessageId: m.id,
          from: m.from,
          receivedAt: new Date(m.receivedAtMs).toISOString(),
          subject: m.subject,
          body: m.body,
        })),
      ),
    ].join('\n')

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }

    try {
      let bodyText = ''
      for (let attempt = 1; attempt <= appConfig.statementGeminiMaxAttempts; attempt++) {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        bodyText = await resp.text()
        if (resp.ok) break
        const canRetry = RETRYABLE_STATUS.has(resp.status)
        if (!canRetry || attempt === appConfig.statementGeminiMaxAttempts) {
          return { ok: false, error: `Gemini HTTP ${resp.status}: ${bodyText}` }
        }
        const sleepMs = appConfig.statementGeminiBackoffMs * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, sleepMs))
      }

      const parsedRoot = JSON.parse(bodyText) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const output = parsedRoot.candidates?.[0]?.content?.parts?.[0]?.text
      if (!output) {
        return { ok: false, error: 'gemini_empty_output' }
      }

      const items = JSON.parse(this.extractJsonArray(output))
      return { ok: true, byMessageId: mapGeminiItemsToById(items, expectedIds) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Gemini txn batch failed issuer=${input.issuer}: ${message}`)
      return { ok: false, error: message }
    }
  }

  private extractJsonArray(output: string): string {
    const trimmed = output.trim()
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    const source = fenced?.[1]?.trim() ?? trimmed
    const start = source.indexOf('[')
    const end = source.lastIndexOf(']')
    if (start >= 0 && end > start) return source.slice(start, end + 1)
    throw new Error('gemini_json_array_not_found')
  }
}
