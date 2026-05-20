import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'

@Injectable()
export class MonthlyPlansService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.monthlyPlan.findMany({
      where: { tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })
  }

  getCurrent(tenantId: string, month: number, year: number) {
    return this.prisma.monthlyPlan.findUnique({
      where: {
        tenantId_year_month: { tenantId, year, month },
      },
    })
  }

  upsert(tenantId: string, actorId: string, dto: UpsertMonthlyPlanDto) {
    return this.prisma.monthlyPlan.upsert({
      where: { tenantId_year_month: { tenantId, year: dto.year, month: dto.month } },
      update: {
        rent: dto.rent,
        cook: dto.cook,
        sip: dto.sip,
        bills: dto.bills,
        basicCcSpent: dto.basicCcSpent,
        loanPayments: dto.loanPayments as never,
        investment: dto.investment,
        liquidSaved: dto.liquidSaved,
        otherExpenses: dto.otherExpenses,
        customExpenses: dto.customExpenses as never,
        salary: dto.salary,
        otherIncome: dto.otherIncome,
        banks: dto.banks as never,
        remarks: dto.remarks,
        updatedBy: actorId,
      },
      create: {
        tenantId,
        month: dto.month,
        year: dto.year,
        rent: dto.rent ?? 0,
        cook: dto.cook ?? 0,
        sip: dto.sip ?? 0,
        bills: dto.bills ?? 0,
        basicCcSpent: dto.basicCcSpent ?? 0,
        loanPayments: (dto.loanPayments ?? []) as never,
        investment: dto.investment ?? 0,
        liquidSaved: dto.liquidSaved ?? 0,
        otherExpenses: dto.otherExpenses ?? 0,
        customExpenses: (dto.customExpenses ?? []) as never,
        salary: dto.salary ?? 0,
        otherIncome: dto.otherIncome ?? 0,
        banks: (dto.banks ?? {}) as never,
        remarks: dto.remarks ?? '',
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  }
}
