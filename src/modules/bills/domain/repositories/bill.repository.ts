import type { Bill } from '@prisma/client'

export const BILL_REPOSITORY = Symbol('BILL_REPOSITORY')

export type BillUpsertInput = {
  id: string
  tenantId: string
  actorId: string
  name: string
  amount: number
  dueDay: number
  frequency: string
  category: string
  status: string
}

export interface IBillRepository {
  listByTenant(tenantId: string): Promise<Bill[]>
  upsert(input: BillUpsertInput): Promise<Bill>
  removeByTenantAndId(tenantId: string, id: string): Promise<number>
}
