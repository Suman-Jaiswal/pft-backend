import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'

@Injectable()
export class MonthlyPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private toNumber(value: unknown): number {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  private sumAmounts(items: unknown): number {
    if (!Array.isArray(items)) return 0
    return items.reduce((sum, item) => {
      if (!item || typeof item !== 'object') return sum
      const amount = this.toNumber((item as { amount?: unknown }).amount)
      return sum + amount
    }, 0)
  }

  private calcFreeCash(input: {
    salary: number
    otherIncome: number
    rent: number
    cook: number
    bills: number
    sip: number
    liquidSaved: number
    investment: number
    otherExpenses: number
    loanPaymentsTotal: number
    customExpensesTotal: number
  }): number {
    const income = input.salary + input.otherIncome
    const expenseOut =
      input.rent +
      input.cook +
      input.bills +
      input.investment +
      input.otherExpenses +
      input.loanPaymentsTotal +
      input.customExpensesTotal
    const savingsAllocation = input.sip + input.liquidSaved
    return income - (expenseOut + savingsAllocation)
  }

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

  async upsert(tenantId: string, actorId: string, dto: UpsertMonthlyPlanDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.monthlyPlan.findUnique({
        where: { tenantId_year_month: { tenantId, year: dto.year, month: dto.month } },
      })

      const oldFreeCash = existing
        ? this.calcFreeCash({
            salary: this.toNumber(existing.salary),
            otherIncome: this.toNumber(existing.otherIncome),
            rent: this.toNumber(existing.rent),
            cook: this.toNumber(existing.cook),
            bills: this.toNumber(existing.bills),
            sip: this.toNumber(existing.sip),
            liquidSaved: this.toNumber(existing.liquidSaved),
            investment: this.toNumber(existing.investment),
            otherExpenses: this.toNumber(existing.otherExpenses),
            loanPaymentsTotal: this.sumAmounts(existing.loanPayments),
            customExpensesTotal: this.sumAmounts(existing.customExpenses),
          })
        : 0

      const mergedLoanPayments = (dto.loanPayments ?? (existing?.loanPayments as unknown[]) ?? []) as unknown[]
      const mergedCustomExpenses = (dto.customExpenses ?? (existing?.customExpenses as unknown[]) ?? []) as unknown[]
      const newFreeCash = this.calcFreeCash({
        salary: this.toNumber(dto.salary ?? existing?.salary ?? 0),
        otherIncome: this.toNumber(dto.otherIncome ?? existing?.otherIncome ?? 0),
        rent: this.toNumber(dto.rent ?? existing?.rent ?? 0),
        cook: this.toNumber(dto.cook ?? existing?.cook ?? 0),
        bills: this.toNumber(dto.bills ?? existing?.bills ?? 0),
        sip: this.toNumber(dto.sip ?? existing?.sip ?? 0),
        liquidSaved: this.toNumber(dto.liquidSaved ?? existing?.liquidSaved ?? 0),
        investment: this.toNumber(dto.investment ?? existing?.investment ?? 0),
        otherExpenses: this.toNumber(dto.otherExpenses ?? existing?.otherExpenses ?? 0),
        loanPaymentsTotal: this.sumAmounts(mergedLoanPayments),
        customExpensesTotal: this.sumAmounts(mergedCustomExpenses),
      })
      // Idempotent monthly update behavior:
      // create => add full month free cash; update => add only delta.
      const stashDelta = newFreeCash - oldFreeCash

      const saved = await tx.monthlyPlan.upsert({
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

      const currentSetting = await tx.pftSetting.findUnique({ where: { tenantId } })
      if (currentSetting) {
        await tx.pftSetting.update({
          where: { tenantId },
          data: {
            stashBalance: this.toNumber(currentSetting.stashBalance) + stashDelta,
            updatedBy: actorId,
          },
        })
      } else {
        await tx.pftSetting.create({
          data: {
            id: `pst_${tenantId}`,
            tenantId,
            stashBalance: stashDelta,
            createdBy: actorId,
            updatedBy: actorId,
          },
        })
      }
      return saved
    })
  }
}
