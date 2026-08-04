export type AdjustmentType = 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'

export type AdjustmentInput = {
  type: AdjustmentType
  personalShare?: number | null
  amortizeMonths?: number | null
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function effectiveForCycleTxn(amount: number, adjustment: AdjustmentInput | null): number {
  if (!adjustment) return roundMoney(amount)
  if (adjustment.type === 'EXCLUDE') return 0
  if (adjustment.type === 'SPLIT') return roundMoney(Number(adjustment.personalShare ?? 0))
  const n = Number(adjustment.amortizeMonths ?? 0)
  if (n < 2) return roundMoney(amount)
  return roundMoney(amount / n)
}

function addCalendarMonths(year: number, monthIndex: number, delta: number): { y: number; m: number } {
  const idx = year * 12 + monthIndex + delta
  return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 }
}

export function effectiveForCalendarMonth(
  amount: number,
  txnDate: Date,
  monthKey: string,
  adjustment: AdjustmentInput | null,
): number {
  if (!adjustment) {
    return formatMonthKey(txnDate) === monthKey ? roundMoney(amount) : 0
  }
  if (adjustment.type === 'EXCLUDE') return 0
  if (adjustment.type === 'SPLIT') {
    return formatMonthKey(txnDate) === monthKey ? roundMoney(Number(adjustment.personalShare ?? 0)) : 0
  }
  const n = Number(adjustment.amortizeMonths ?? 0)
  if (n < 2) return 0
  const slice = roundMoney(amount / n)
  const startY = txnDate.getFullYear()
  const startM = txnDate.getMonth()
  for (let i = 0; i < n; i++) {
    const { y, m } = addCalendarMonths(startY, startM, i)
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    if (key === monthKey) return slice
  }
  return 0
}
