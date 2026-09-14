import { isGeminiDailyQuotaExhausted } from '@/modules/import-jobs/services/gemini-quota.util'

const dailyQuotaBody = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_requests_per_model',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          },
        ],
      },
    ],
  },
})

const perMinuteQuotaBody = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
      },
    ],
  },
})

describe('isGeminiDailyQuotaExhausted', () => {
  it('detects a per-day quota violation', () => {
    expect(isGeminiDailyQuotaExhausted(429, dailyQuotaBody)).toBe(true)
  })

  it('does not flag a per-minute quota violation', () => {
    expect(isGeminiDailyQuotaExhausted(429, perMinuteQuotaBody)).toBe(false)
  })

  it('ignores non-429 statuses entirely', () => {
    expect(isGeminiDailyQuotaExhausted(500, dailyQuotaBody)).toBe(false)
  })

  it('is safe against malformed/non-JSON bodies', () => {
    expect(isGeminiDailyQuotaExhausted(429, 'not json')).toBe(false)
    expect(isGeminiDailyQuotaExhausted(429, '')).toBe(false)
  })

  it('ignores 429s that are not RESOURCE_EXHAUSTED', () => {
    const body = JSON.stringify({ error: { status: 'UNAVAILABLE' } })
    expect(isGeminiDailyQuotaExhausted(429, body)).toBe(false)
  })
})
