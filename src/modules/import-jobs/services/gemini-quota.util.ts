/**
 * Distinguishes a Gemini "requests per day" (RPD) quota exhaustion from a
 * transient/per-minute 429. RPD exhaustion won't recover until the daily
 * reset, so retrying it with exponential backoff (our normal 429 handling)
 * just wastes the entire backoff window on every single call for the rest
 * of the day. Per-minute throttles and 5xx blips are still worth retrying.
 */
export function isGeminiDailyQuotaExhausted(status: number, bodyText: string): boolean {
  if (status !== 429) return false
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: {
        status?: string
        details?: Array<{ violations?: Array<{ quotaId?: string; quotaMetric?: string }> }>
      }
    }
    if (parsed.error?.status !== 'RESOURCE_EXHAUSTED') return false
    const violations = parsed.error.details?.flatMap((d) => d.violations ?? []) ?? []
    return violations.some(
      (v) => /perday/i.test(v.quotaId ?? '') || /perday/i.test(v.quotaMetric ?? ''),
    )
  } catch {
    return false
  }
}
