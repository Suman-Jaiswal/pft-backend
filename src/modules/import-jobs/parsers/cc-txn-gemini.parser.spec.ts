import { mapGeminiItemsToById, stripToFourDigits, CcTxnGeminiParser } from '@/modules/import-jobs/parsers/cc-txn-gemini.parser'
import { appConfig } from '@/config/app.config'

function geminiEnvelope(items: unknown, wrap?: 'raw' | 'fenced'): string {
  const json = JSON.stringify(items)
  const text = wrap === 'fenced' ? `\`\`\`json\n${json}\n\`\`\`` : json
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  })
}

function jsonResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }
}

describe('mapGeminiItemsToById', () => {
  it('aligns by gmailMessageId and marks missing ids', () => {
    const mapped = mapGeminiItemsToById(
      [
        { gmailMessageId: 'a', ok: true, last4: 'XX5965', amount: 120, txnDate: '2026-09-01', merchant: 'X' },
        { gmailMessageId: 'extra', ok: true, last4: '1111', amount: 1 },
      ],
      ['a', 'b'],
    )
    expect(mapped.a.ok).toBe(true)
    expect(mapped.a.last4).toBe('5965')
    expect(mapped.b).toEqual({ ok: false, skipReason: 'missing_from_model' })
  })

  it('maps out-of-order items by id', () => {
    const mapped = mapGeminiItemsToById(
      [
        { gmailMessageId: 'b', ok: true, last4: '9003', amount: 20 },
        { gmailMessageId: 'a', ok: true, last4: '5000', amount: 10 },
      ],
      ['a', 'b'],
    )
    expect(mapped.a.last4).toBe('5000')
    expect(mapped.b.last4).toBe('9003')
  })

  it('marks alignment misses when gmailMessageId does not match expected ids', () => {
    const mapped = mapGeminiItemsToById([{ gmailMessageId: 'other', ok: true, last4: '1234', amount: 5 }], ['expected'])
    expect(mapped.expected).toEqual({ ok: false, skipReason: 'missing_from_model' })
  })

  it('marks every expected id when items is not an array', () => {
    const mapped = mapGeminiItemsToById({ gmailMessageId: 'a' }, ['a', 'b'])
    expect(mapped.a).toEqual({ ok: false, skipReason: 'missing_from_model' })
    expect(mapped.b).toEqual({ ok: false, skipReason: 'missing_from_model' })
  })

  it('keeps skipReason when the model says the mail is not a txn', () => {
    const mapped = mapGeminiItemsToById(
      [{ gmailMessageId: 'otp1', ok: false, skipReason: 'otp' }],
      ['otp1'],
    )
    expect(mapped.otp1.ok).toBe(false)
    expect(mapped.otp1.skipReason).toBe('otp')
  })
})

describe('stripToFourDigits', () => {
  it('takes the last four digits', () => {
    expect(stripToFourDigits('XX1234')).toBe('1234')
    expect(stripToFourDigits('ending 9335')).toBe('9335')
    expect(stripToFourDigits(5965)).toBe('5965')
  })

  it('returns undefined when fewer than four digits', () => {
    expect(stripToFourDigits('12')).toBeUndefined()
    expect(stripToFourDigits(undefined)).toBeUndefined()
  })
})

describe('CcTxnGeminiParser.parseBatch', () => {
  const original = {
    statementGeminiApiKey: appConfig.statementGeminiApiKey,
    statementGeminiModel: appConfig.statementGeminiModel,
    statementGeminiMaxAttempts: appConfig.statementGeminiMaxAttempts,
    statementGeminiBackoffMs: appConfig.statementGeminiBackoffMs,
  }
  const originalFetch = global.fetch
  const parser = new CcTxnGeminiParser()

  beforeEach(() => {
    appConfig.statementGeminiApiKey = 'test-key'
    appConfig.statementGeminiModel = 'gemini-2.5-flash'
    appConfig.statementGeminiMaxAttempts = 3
    appConfig.statementGeminiBackoffMs = 0
  })

  afterEach(() => {
    Object.assign(appConfig, original)
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('returns ok:false when API key is missing', async () => {
    appConfig.statementGeminiApiKey = ''
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result).toEqual({ ok: false, error: 'gemini_not_configured: statementGeminiApiKey missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a successful Gemini JSON array and calls the statement generateContent URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        200,
        geminiEnvelope([
          {
            gmailMessageId: '1',
            ok: true,
            last4: '5965',
            amount: 99,
            txnDate: '2026-09-11',
            merchant: 'Store',
            referenceNo: 'R1',
            channel: 'UPI',
          },
        ]),
      ),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'alerts@sbi.co.in', subject: 'txn', body: 'spent INR 99', receivedAtMs: 1 }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.byMessageId['1']).toEqual({
        ok: true,
        last4: '5965',
        amount: 99,
        txnDate: '2026-09-11',
        merchant: 'Store',
        referenceNo: 'R1',
        channel: 'UPI',
      })
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-key',
    )
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    const payload = JSON.parse(String(init.body))
    expect(payload.generationConfig).toEqual({ temperature: 0.1, responseMimeType: 'application/json' })
    expect(payload.contents[0].parts[0].text).toContain('Issuer / folder context: SBI')
    expect(payload.contents[0].parts[0].text).toContain('STRICT JSON')
    expect(payload.contents[0].parts[0].text).toContain('Ignore OTPs')
    expect(payload.contents[0].parts[0].text).toContain('gmailMessageId')
  })

  it('accepts fenced JSON from Gemini', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        200,
        geminiEnvelope([{ gmailMessageId: '1', ok: true, last4: '5965', amount: 10, txnDate: '2026-09-11' }], 'fenced'),
      ),
    ) as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'HDFC',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.byMessageId['1'].ok).toBe(true)
  })

  it('marks a non-txn mail with skipReason while keeping the batch ok', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        200,
        geminiEnvelope([
          { gmailMessageId: '1', ok: true, last4: '5965', amount: 50, txnDate: '2026-09-11', merchant: 'A' },
          { gmailMessageId: '2', ok: false, skipReason: 'otp' },
        ]),
      ),
    ) as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [
        { id: '1', from: 'a', subject: 'txn', body: 'spent', receivedAtMs: 1 },
        { id: '2', from: 'a', subject: 'OTP', body: '123456 is your OTP', receivedAtMs: 2 },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.byMessageId['1'].ok).toBe(true)
      expect(result.byMessageId['2']).toMatchObject({ ok: false, skipReason: 'otp' })
    }
  })

  it('retries 429 then succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, 'quota'))
      .mockResolvedValueOnce(
        jsonResponse(200, geminiEnvelope([{ gmailMessageId: '1', ok: true, last4: '5965', amount: 1 }])),
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'ICICI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns ok:false on HTTP 429 after retries exhausted', async () => {
    appConfig.statementGeminiMaxAttempts = 2
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(429, 'quota'))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result).toEqual({ ok: false, error: 'Gemini HTTP 429: quota' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable HTTP 400', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(400, 'bad request'))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result).toEqual({ ok: false, error: 'Gemini HTTP 400: bad request' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns ok:false when the HTTP body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, 'not-json')) as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('returns ok:false when Gemini output is empty', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] })),
    ) as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result).toEqual({ ok: false, error: 'gemini_empty_output' })
  })

  it('returns ok:false when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    const result = await parser.parseBatch({
      issuer: 'SBI',
      messages: [{ id: '1', from: 'a', subject: 's', body: 'b', receivedAtMs: 1 }],
    })
    expect(result).toEqual({ ok: false, error: 'network down' })
  })
})
