export type MonthlySplitCalculatorInput = {
  salary: number
  otherSources: number
  rent: number
  cook: number
  bills: number
  sipMf: number
  savings: number
  stash: number
  stocks: number
  fd: { amount: number; quantity: number }
  otherExpenses: number
  loanPaymentsTotal: number
  goalPaymentsTotal: number
  customExpensesTotal: number
}

export function calcIncome(input: Pick<MonthlySplitCalculatorInput, 'salary' | 'otherSources'>): number {
  return input.salary + input.otherSources
}

export function calcExpenseOut(
  input: Pick<
    MonthlySplitCalculatorInput,
    | 'rent'
    | 'cook'
    | 'bills'
    | 'stocks'
    | 'fd'
    | 'otherExpenses'
    | 'loanPaymentsTotal'
    | 'customExpensesTotal'
  >,
): number {
  return (
    input.rent +
    input.cook +
    input.bills +
    input.stocks +
    input.fd.amount * input.fd.quantity +
    input.otherExpenses +
    input.loanPaymentsTotal +
    input.customExpensesTotal
  )
}

export function calcSavingsAllocation(
  input: Pick<MonthlySplitCalculatorInput, 'sipMf' | 'savings' | 'stash' | 'goalPaymentsTotal'>,
): number {
  return input.sipMf + input.savings + input.stash + input.goalPaymentsTotal
}

export function calcTotalOut(input: MonthlySplitCalculatorInput): number {
  return calcExpenseOut(input) + calcSavingsAllocation(input)
}

export function calcFreeCash(input: MonthlySplitCalculatorInput): number {
  return calcIncome(input) - calcTotalOut(input)
}
