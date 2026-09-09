export function formatFiscalHalfKey(startYear: number, half: 1 | 2): string {
  return `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}_H${half}`
}

export function fiscalHalfFromDate(now = new Date()): { startYear: number; half: 1 | 2 } {
  const month = now.getMonth() + 1
  const startYear = month >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const half: 1 | 2 = month >= 4 && month <= 9 ? 1 : 2
  return { startYear, half }
}

export function getCurrentFiscalHalfKey(now = new Date()): string {
  const { startYear, half } = fiscalHalfFromDate(now)
  return formatFiscalHalfKey(startYear, half)
}

export function getNextFiscalHalfKey(now = new Date()): string {
  const { startYear, half } = fiscalHalfFromDate(now)
  return half === 1 ? formatFiscalHalfKey(startYear, 2) : formatFiscalHalfKey(startYear + 1, 1)
}

export function parseFiscalHalfKey(periodKey: string): { startYear: number; half: 1 | 2 } | null {
  const match = /^FY(\d{2})-(\d{2})_H([12])$/.exec(periodKey)
  if (!match) return null
  return { startYear: 2000 + Number(match[1]), half: Number(match[3]) as 1 | 2 }
}

export function isFiscalHalfLocked(periodKey: string, now = new Date()): boolean {
  const parsed = parseFiscalHalfKey(periodKey)
  if (!parsed) return true
  const current = fiscalHalfFromDate(now)
  return (
    parsed.startYear < current.startYear ||
    (parsed.startYear === current.startYear && parsed.half <= current.half)
  )
}

export function isCreatableFiscalHalf(periodKey: string, now = new Date()): boolean {
  return periodKey === getCurrentFiscalHalfKey(now) || periodKey === getNextFiscalHalfKey(now)
}
