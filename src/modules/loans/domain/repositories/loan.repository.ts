import type { Loan } from '@prisma/client'

export const LOAN_REPOSITORY = Symbol('LOAN_REPOSITORY')

export type LoanUpsertInput = {
  id: string
  tenantId: string
  actorId: string
  name: string
  principal: number
  emi: number
  rate: number
  startDate: Date
  tenureMonths: number
  status: string
}

export interface ILoanRepository {
  listByTenant(tenantId: string): Promise<Loan[]>
  upsert(input: LoanUpsertInput): Promise<Loan>
  transitionStatus(tenantId: string, actorId: string, id: string, status: string): Promise<number>
  removeByTenantAndId(tenantId: string, id: string): Promise<number>
}
