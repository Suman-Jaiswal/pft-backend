import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'
import {
  IMonthlyPlanRepository,
  MONTHLY_PLAN_REPOSITORY,
} from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'
import { z } from 'zod'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { FdLedgerService } from '@/modules/fd-ledger/fd-ledger.service'
import { InvestmentsService } from '@/modules/investments/investments.service'

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
const goalPaymentsArraySchema = z.array(loanPaymentSchema)
const customExpensesArraySchema = z.array(customExpenseSchema)
const banksSchema = z.record(z.string(), z.number().finite())

@Injectable()
export class MonthlyPlansService {
  constructor(
    @Inject(MONTHLY_PLAN_REPOSITORY) private readonly repository: IMonthlyPlanRepository,
    private readonly prisma: PrismaService,
    private readonly fdLedger: FdLedgerService,
    private readonly investments: InvestmentsService,
  ) {}

  private normalizeLoanPayments(items: unknown): Array<{ id: string; name: string; amount: number }> {
    if (!Array.isArray(items)) return []
    return loanPaymentsArraySchema.safeParse(items).success
      ? (items as Array<{ id: string; name: string; amount: number }>)
      : []
  }

  private normalizeGoalPayments(items: unknown): Array<{ id: string; name: string; amount: number }> {
    if (!Array.isArray(items)) return []
    return goalPaymentsArraySchema.safeParse(items).success
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
    const [plans, settings, activeLoans, fdSummary, investmentSummary] = await Promise.all([
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
      this.fdLedger.summarize(tenantId),
      this.investments.summarize(tenantId),
    ])

    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()
    const currentPlan = plans.find((plan) => plan.month === currentMonth && plan.year === currentYear) ?? null

    const paidByLoanId: Record<string, number> = {}
    let totalStash = 0
    let totalPositiveSavings = 0
    let totalDeficitWithdrawals = 0
    let savingsCash = 0
    let goalsTotal = 0

    for (const plan of plans) {
      totalStash += Number(plan.stash ?? 0)
      const savings = Number(plan.savings ?? 0)
      const fd = this.fdLedger.normalizePacket(plan.fd)
      const stocks = Number(plan.stocks ?? 0)
      const sipMf = Number(plan.sipMf ?? 0)
      const goalPayments = this.normalizeGoalPayments(plan.goalPayments as unknown)
        .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      savingsCash += Math.max(0, savings)
      goalsTotal += Math.max(0, goalPayments)
      totalPositiveSavings += Math.max(0, savings) + Math.max(0, goalPayments)

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
      const liquid = Math.max(0, savings + Number(plan.stash ?? 0) + goalPayments)
      const fdOut = fd.amount * fd.quantity
      const deficit = Math.max(0, expenses + investment + liquid + fdOut - income)
      totalDeficitWithdrawals += deficit

      for (const entry of this.normalizeLoanPayments(plan.loanPayments as unknown)) {
        const current = paidByLoanId[entry.id] ?? 0
        paidByLoanId[entry.id] = current + Number(entry.amount ?? 0)
      }
    }

    const prevLiquid = Number(settings?.prevLiquidBalance ?? 0)
    const stashDeductions = Number(settings?.stashDeductions ?? 0)
    const soldInvestments =
      investmentSummary.soldMfRupees + investmentSummary.soldStocksRupees

    const cashLike =
      prevLiquid +
      totalPositiveSavings +
      fdSummary.brokenFdRupees +
      soldInvestments -
      totalDeficitWithdrawals
    const fd = fdSummary.fdBalance
    const liquid = cashLike + fd
    const stocks = investmentSummary.stocksBalance
    const mf = investmentSummary.mfBalance
    const investment = investmentSummary.investmentBalance
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
        savingsCash,
        goalsTotal,
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
      fd: {
        remainingPackets: fdSummary.remainingPackets,
        balance: fdSummary.fdBalance,
        brokenRupees: fdSummary.brokenFdRupees,
        lots: fdSummary.lots,
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
      const fd = dto.fd === undefined ? undefined : this.fdLedger.normalizePacket(dto.fd)

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
          goalPayments:
            dto.goalPayments === undefined
              ? undefined
              : this.normalizeGoalPayments(dto.goalPayments) as never,
          stocks: dto.stocks,
          fd: fd as Prisma.InputJsonValue | undefined,
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
          goalPayments: this.normalizeGoalPayments(dto.goalPayments ?? []) as never,
          stocks: dto.stocks ?? 0,
          fd: (fd ?? { amount: 0, quantity: 0 }) as Prisma.InputJsonValue,
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
      await this.investments.lockAndValidatePlanWrite(
        tenantId,
        dto.year,
        dto.month,
        dto.sipMf,
        dto.stocks,
        tx.transaction,
      )
      const saved = await tx.upsertMonthlyPlan({
        tenantId,
        month: dto.month,
        year: dto.year,
        update: updateData,
        create: createData,
      })
      await this.fdLedger.syncContribution(
        tenantId,
        actorId,
        dto.year,
        dto.month,
        this.fdLedger.normalizePacket(saved.fd),
        tx.transaction,
      )
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
