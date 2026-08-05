import {
  effectiveForCycleTxn,
  effectiveForCalendarMonth,
  formatMonthKey,
} from '@/modules/transactions/domain/effective-amount'

describe('effective-amount', () => {
  it('cycle: no adjustment returns full amount', () => {
    expect(effectiveForCycleTxn(12000, null)).toBe(12000)
  })

  it('cycle: SPLIT returns personalShare', () => {
    expect(effectiveForCycleTxn(3000, { type: 'SPLIT', personalShare: 750 })).toBe(750)
  })

  it('cycle: EXCLUDE returns 0', () => {
    expect(effectiveForCycleTxn(3000, { type: 'EXCLUDE' })).toBe(0)
  })

  it('cycle: AMORTIZE returns one monthly slice', () => {
    expect(effectiveForCycleTxn(12000, { type: 'AMORTIZE', amortizeMonths: 12 })).toBe(1000)
  })

  it('calendar: AMORTIZE contributes in covered months only', () => {
    const txnDate = new Date(2026, 6, 20) // Jul 2026
    const adj = { type: 'AMORTIZE' as const, amortizeMonths: 3 }
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-07', adj)).toBe(3000)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-08', adj)).toBe(3000)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-09', adj)).toBe(3000)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-10', adj)).toBe(0)
    expect(effectiveForCalendarMonth(9000, txnDate, '2026-06', adj)).toBe(0)
  })

  it('calendar: SPLIT only in txn month', () => {
    const txnDate = new Date(2026, 6, 20)
    const adj = { type: 'SPLIT' as const, personalShare: 750 }
    expect(effectiveForCalendarMonth(3000, txnDate, '2026-07', adj)).toBe(750)
    expect(effectiveForCalendarMonth(3000, txnDate, '2026-08', adj)).toBe(0)
  })

  it('formatMonthKey uses local calendar parts', () => {
    expect(formatMonthKey(new Date(2026, 0, 5))).toBe('2026-01')
  })
})
