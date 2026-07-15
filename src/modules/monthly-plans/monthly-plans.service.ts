import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'
import {
  IMonthlyPlanRepository,
  MONTHLY_PLAN_REPOSITORY,
} from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'
import { z } from 'zod'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const loanPaymentSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  amount: z.number().finite(),
})

const customExpenseSchema = z.object({
  label: z.string().trim().min(1),
  amount: z.number().finite(),
})

const loanPaymentsArraySchema = z.array(loanPaymentSchema)
const customExpensesArraySchema = z.array(customExpenseSchema)
const banksSchema = z.record(z.string(), z.number().finite())

@Injectable()
export class MonthlyPlansService {
  constructor(
    @Inject(MONTHLY_PLAN_REPOSITORY) private readonly repository: IMonthlyPlanRepository,
    private readonly prisma: PrismaService,
  ) {}

  private normalizeLoanPayments(items: unknown): Array<{ id: string; name: string; amount: number }> {
    if (!Array.isArray(items)) return []
    return loanPaymentsArraySchema.safeParse(items).success
      ? (items as Array<{ id: string; name: string; amount: number }>)
      : []
  }

  private normalizeCustomExpenses(items: unknown): Array<{ label: string; amount: number }> {
    if (!Array.isArray(items)) return []
    return customExpensesArraySchema.safeParse(items).success
      ? (items as Array<{ label: string; amount: number }>)
      : []
  }

  private normalizeBanks(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return banksSchema.safeParse(value).success ? (value as Record<string, number>) : {}
  }

  list(tenantId: string) {
    return this.repository.listByTenant(tenantId)
  }

  getCurrent(tenantId: string, month: number, year: number) {
    return this.repository.findCurrent(tenantId, month, year)
  }

  async getOutlook(tenantId: string, period: string) {
    const plans = await this.repository.listByTenant(tenantId)
    const allowed = new Set(this.resolvePeriodMonths(period).map(({ month, year }) => `${year}-${month}`))
    return plans.filter((plan) => allowed.has(`${plan.year}-${plan.month}`))
  }

  async getDashboardSummary(tenantId: string) {
    const [plans, settings, activeLoans] = await Promise.all([
      this.repository.listByTenant(tenantId),
      this.prisma.pftSetting.findFirst({ where: { tenantId } }),
      this.prisma.loan.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          principal: true,
          emi: true,
          rate: true,
          startDate: true,
          tenureMonths: true,
          status: true,
          createdAt: true,
        },
      }),
    ])

    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()
    const currentPlan = plans.find((plan) => plan.month === currentMonth && plan.year === currentYear) ?? null

    const paidByLoanId: Record<string, number> = {}
    let totalStash = 0
    let totalPositiveSavings = 0
    let totalPositiveFd = 0
    let totalStocks = 0
    let totalSipMf = 0
    let totalDeficitWithdrawals = 0

    for (const plan of plans) {
      totalStash += Number(plan.stash ?? 0)
      const savings = Number(plan.savings ?? 0)
      const fd = Number(plan.fd ?? 0)
      const stocks = Number(plan.stocks ?? 0)
      const sipMf = Number(plan.sipMf ?? 0)
      totalPositiveSavings += Math.max(0, savings)
      totalPositiveFd += Math.max(0, fd)
      totalStocks += stocks
      totalSipMf += sipMf

      const income = Number(plan.salary ?? 0) + Number(plan.otherSources ?? 0)
      const loanPayments = this.normalizeLoanPayments(plan.loanPayments as unknown)
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      const customExpenses = this.normalizeCustomExpenses(plan.customExpenses as unknown)
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      const expenses =
        Number(plan.rent ?? 0) +
        Number(plan.cook ?? 0) +
        Number(plan.bills ?? 0) +
        Number(plan.otherExpenses ?? 0) +
        loanPayments +
        customExpenses
      const investment = Math.max(0, stocks + sipMf)
      const liquid = Math.max(0, savings + fd)
      const deficit = Math.max(0, expenses + investment + liquid - income)
      totalDeficitWithdrawals += deficit

      for (const entry of this.normalizeLoanPayments(plan.loanPayments as unknown)) {
        const current = paidByLoanId[entry.id] ?? 0
        paidByLoanId[entry.id] = current + Number(entry.amount ?? 0)
      }
    }

    const prevLiquid = Number(settings?.prevLiquidBalance ?? 0)
    const prevInvestment = Number(settings?.prevInvestmentBalance ?? 0)
    const stashDeductions = Number(settings?.stashDeductions ?? 0)

    const cashLike = prevLiquid + totalPositiveSavings - totalDeficitWithdrawals
    const fd = totalPositiveFd
    const liquid = cashLike + fd
    const stocks = prevInvestment + totalStocks
    const mf = totalSipMf
    const investment = stocks + mf
    const corpusTotal = liquid + investment
    const loanRemainingTotal = activeLoans.reduce((sum, loan) => {
      const principal = Number(loan.principal ?? 0)
      const paid = Number(paidByLoanId[loan.id] ?? 0)
      return sum + Math.max(0, principal - paid)
    }, 0)

    return {
      currentPlan,
      corpus: {
        cashLike,
        fd,
        liquid,
        stocks,
        mf,
        investment,
        total: corpusTotal,
        deficitWithdrawals: totalDeficitWithdrawals,
      },
      stash: {
        totalAccumulated: totalStash,
        deductions: stashDeductions,
        balance: totalStash - stashDeductions,
      },
      loans: {
        activeLoans: activeLoans.map((loan) => ({
          id: loan.id,
          name: loan.name,
          principal: Number(loan.principal ?? 0),
          emi: Number(loan.emi ?? 0),
          rate: Number(loan.rate ?? 0),
          startDate: loan.startDate.toISOString(),
          tenureMonths: Number(loan.tenureMonths ?? 0),
          status: loan.status,
          createdAt: loan.createdAt.toISOString(),
        })),
        paidByLoanId,
        remainingTotal: loanRemainingTotal,
      },
    }
  }

  async upsert(tenantId: string, actorId: string, dto: UpsertMonthlyPlanDto) {
    return this.repository.runInTransaction(async (tx) => {
      const mergedCustomExpenses = this.normalizeCustomExpenses(dto.customExpenses ?? [])

      const updateData: Prisma.MonthlyPlanUpdateInput = {
          rent: dto.rent,
          cook: dto.cook,
          sipMf: dto.sipMf,
          bills: dto.bills,
          basicCcSpent: dto.basicCcSpent,
          loanPayments:
            dto.loanPayments === undefined
              ? undefined
              : this.normalizeLoanPayments(dto.loanPayments) as never,
          stocks: dto.stocks,
          fd: dto.fd,
          savings: dto.savings,
          stash: dto.stash,
          otherExpenses: dto.otherExpenses,
          customExpenses: mergedCustomExpenses as never,
          salary: dto.salary,
          otherSources: dto.otherSources,
          banks: this.normalizeBanks(dto.banks) as never,
          remarks: dto.remarks,
          updatedBy: actorId,
        }
      const createData: Prisma.MonthlyPlanCreateInput = {
          tenantId,
          month: dto.month,
          year: dto.year,
          rent: dto.rent ?? 0,
          cook: dto.cook ?? 0,
          sipMf: dto.sipMf ?? 0,
          bills: dto.bills ?? 0,
          basicCcSpent: dto.basicCcSpent ?? 0,
          loanPayments: this.normalizeLoanPayments(dto.loanPayments ?? []) as never,
          stocks: dto.stocks ?? 0,
          fd: dto.fd ?? 0,
          savings: dto.savings ?? 0,
          stash: dto.stash ?? 0,
          otherExpenses: dto.otherExpenses ?? 0,
          customExpenses: this.normalizeCustomExpenses(dto.customExpenses ?? []) as never,
          salary: dto.salary ?? 0,
          otherSources: dto.otherSources ?? 0,
          banks: this.normalizeBanks(dto.banks) as never,
          remarks: dto.remarks ?? '',
          createdBy: actorId,
          updatedBy: actorId,
        }
      const saved = await tx.upsertMonthlyPlan({
        tenantId,
        month: dto.month,
        year: dto.year,
        update: updateData,
        create: createData,
      })
      return saved
    })
  }

  private resolvePeriodMonths(period: string): Array<{ month: number; year: number }> {
    if (period === '__L12M__') return this.last12Months()
    if (period.endsWith('_H1') || period.endsWith('_H2')) {
      const half = period.slice(-2) as 'H1' | 'H2'
      return this.fiscalYearMonths(period.slice(0, -3), half)
    }
    return this.fiscalYearMonths(period)
  }

  private last12Months(): Array<{ month: number; year: number }> {
    const now = new Date()
    const out: Array<{ month: number; year: number }> = []
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({ month: date.getMonth() + 1, year: date.getFullYear() })
    }
    return out
  }

  private fiscalYearMonths(fiscalYear: string, half?: 'H1' | 'H2'): Array<{ month: number; year: number }> {
    const match = /^FY(\d{2})-(\d{2})$/.exec(fiscalYear)
    if (!match) return []
    const startYear = 2000 + Number(match[1])
    const out: Array<{ month: number; year: number }> = []
    for (let i = 0; i < 12; i += 1) {
      const date = new Date(startYear, 3 + i, 1)
      out.push({ month: date.getMonth() + 1, year: date.getFullYear() })
    }
    if (half === 'H1') return out.slice(0, 6)
    if (half === 'H2') return out.slice(6, 12)
    return out
  }
}
