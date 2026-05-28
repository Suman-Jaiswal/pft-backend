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
    otherSources: number
    rent: number
    cook: number
    bills: number
    sipMf: number
    savings: number
    stocks: number
    fd: number
    otherExpenses: number
    loanPaymentsTotal: number
    customExpensesTotal: number
  }): number {
    const income = input.salary + input.otherSources
    const expenseOut =
      input.rent +
      input.cook +
      input.bills +
      input.stocks +
      input.fd +
      input.otherExpenses +
      input.loanPaymentsTotal +
      input.customExpensesTotal
    const savingsAllocation = input.sipMf + input.savings
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
            otherSources: this.toNumber(existing.otherSources),
            rent: this.toNumber(existing.rent),
            cook: this.toNumber(existing.cook),
            bills: this.toNumber(existing.bills),
            sipMf: this.toNumber(existing.sipMf),
            savings: this.toNumber(existing.savings),
            stocks: this.toNumber(existing.stocks),
            fd: this.toNumber(existing.fd),
            otherExpenses: this.toNumber(existing.otherExpenses),
            loanPaymentsTotal: this.sumAmounts(existing.loanPayments),
            customExpensesTotal: this.sumAmounts(existing.customExpenses),
          })
        : 0

      const mergedLoanPayments = (dto.loanPayments ?? (existing?.loanPayments as unknown[]) ?? []) as unknown[]
      const mergedCustomExpenses = (dto.customExpenses ?? (existing?.customExpenses as unknown[]) ?? []) as unknown[]
      const newFreeCash = this.calcFreeCash({
        salary: this.toNumber(dto.salary ?? existing?.salary ?? 0),
        otherSources: this.toNumber(dto.otherSources ?? existing?.otherSources ?? 0),
        rent: this.toNumber(dto.rent ?? existing?.rent ?? 0),
        cook: this.toNumber(dto.cook ?? existing?.cook ?? 0),
        bills: this.toNumber(dto.bills ?? existing?.bills ?? 0),
        sipMf: this.toNumber(dto.sipMf ?? existing?.sipMf ?? 0),
        savings: this.toNumber(dto.savings ?? existing?.savings ?? 0),
        stocks: this.toNumber(dto.stocks ?? existing?.stocks ?? 0),
        fd: this.toNumber(dto.fd ?? existing?.fd ?? 0),
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
          sipMf: dto.sipMf,
          bills: dto.bills,
          basicCcSpent: dto.basicCcSpent,
          loanPayments: dto.loanPayments as never,
          stocks: dto.stocks,
          fd: dto.fd,
          savings: dto.savings,
          otherExpenses: dto.otherExpenses,
          customExpenses: dto.customExpenses as never,
          salary: dto.salary,
          otherSources: dto.otherSources,
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
          sipMf: dto.sipMf ?? 0,
          bills: dto.bills ?? 0,
          basicCcSpent: dto.basicCcSpent ?? 0,
          loanPayments: (dto.loanPayments ?? []) as never,
          stocks: dto.stocks ?? 0,
          fd: dto.fd ?? 0,
          savings: dto.savings ?? 0,
          otherExpenses: dto.otherExpenses ?? 0,
          customExpenses: (dto.customExpenses ?? []) as never,
          salary: dto.salary ?? 0,
          otherSources: dto.otherSources ?? 0,
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
