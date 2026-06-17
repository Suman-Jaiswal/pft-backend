import {
  calcExpenseOut,
  calcFreeCash,
  calcIncome,
  calcSavingsAllocation,
  calcTotalOut,
} from '@/modules/monthly-plans/domain/monthly-split.calculator'

describe('monthly split calculator', () => {
  const input = {
    salary: 120000,
    otherSources: 5000,
    rent: 20000,
    cook: 4000,
    bills: 7000,
    sipMf: 10000,
    savings: 3000,
    stash: 4000,
    stocks: 5000,
    fd: 2000,
    otherExpenses: 1500,
    loanPaymentsTotal: 6000,
    customExpensesTotal: 2500,
  }

  it('computes income', () => {
    expect(calcIncome(input)).toBe(125000)
  })

  it('computes expense out', () => {
    expect(calcExpenseOut(input)).toBe(48000)
  })

  it('computes savings allocation', () => {
    expect(calcSavingsAllocation(input)).toBe(17000)
  })

  it('computes total out', () => {
    expect(calcTotalOut(input)).toBe(65000)
  })

  it('computes free cash', () => {
    expect(calcFreeCash(input)).toBe(60000)
  })
})
