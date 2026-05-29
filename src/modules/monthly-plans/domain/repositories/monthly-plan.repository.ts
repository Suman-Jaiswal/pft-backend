import type { MonthlyPlan, PftSetting, Prisma } from '@prisma/client'

export const MONTHLY_PLAN_REPOSITORY = Symbol('MONTHLY_PLAN_REPOSITORY')

export interface IMonthlyPlanRepository {
  listByTenant(tenantId: string): Promise<MonthlyPlan[]>
  findCurrent(tenantId: string, month: number, year: number): Promise<MonthlyPlan | null>
  runInTransaction<T>(fn: (ctx: {
    findCurrent: (tenantId: string, month: number, year: number) => Promise<MonthlyPlan | null>
    upsertMonthlyPlan: (args: {
      tenantId: string
      month: number
      year: number
      update: Prisma.MonthlyPlanUpdateInput
      create: Prisma.MonthlyPlanCreateInput
    }) => Promise<MonthlyPlan>
    findSetting: (tenantId: string) => Promise<PftSetting | null>
    updateSetting: (tenantId: string, data: Prisma.PftSettingUpdateInput) => Promise<PftSetting>
    createSetting: (data: Prisma.PftSettingCreateInput) => Promise<PftSetting>
  }) => Promise<T>): Promise<T>
}
