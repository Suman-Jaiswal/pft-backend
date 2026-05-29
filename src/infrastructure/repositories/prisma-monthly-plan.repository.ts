import { Injectable } from '@nestjs/common'
import { MonthlyPlan, PftSetting, Prisma } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { IMonthlyPlanRepository } from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'

@Injectable()
export class PrismaMonthlyPlanRepository implements IMonthlyPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByTenant(tenantId: string) {
    return this.prisma.monthlyPlan.findMany({
      where: { tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })
  }

  findCurrent(tenantId: string, month: number, year: number) {
    return this.prisma.monthlyPlan.findUnique({
      where: { tenantId_year_month: { tenantId, year, month } },
    })
  }

  runInTransaction<T>(
    fn: (ctx: {
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
    }) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      return fn({
        findCurrent: (tenantId: string, month: number, year: number) =>
          tx.monthlyPlan.findUnique({ where: { tenantId_year_month: { tenantId, year, month } } }),
        upsertMonthlyPlan: ({ tenantId, month, year, update, create }) =>
          tx.monthlyPlan.upsert({
            where: { tenantId_year_month: { tenantId, year, month } },
            update,
            create,
          }),
        findSetting: (tenantId: string) => tx.pftSetting.findUnique({ where: { tenantId } }),
        updateSetting: (tenantId: string, data: Prisma.PftSettingUpdateInput) =>
          tx.pftSetting.update({ where: { tenantId }, data }),
        createSetting: (data: Prisma.PftSettingCreateInput) => tx.pftSetting.create({ data }),
      })
    })
  }
}
