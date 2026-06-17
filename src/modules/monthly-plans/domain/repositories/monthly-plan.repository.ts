import type { MonthlyPlan, Prisma } from '@prisma/client'

export const MONTHLY_PLAN_REPOSITORY = Symbol('MONTHLY_PLAN_REPOSITORY')

export interface IMonthlyPlanRepository {
  listByTenant(tenantId: string): Promise<MonthlyPlan[]>
  findCurrent(tenantId: string, month: number, year: number): Promise<MonthlyPlan | null>
  runInTransaction<T>(fn: (ctx: {
    upsertMonthlyPlan: (args: {
      tenantId: string
      month: number
      year: number
      update: Prisma.MonthlyPlanUpdateInput
      create: Prisma.MonthlyPlanCreateInput
    }) => Promise<MonthlyPlan>
  }) => Promise<T>): Promise<T>
}
