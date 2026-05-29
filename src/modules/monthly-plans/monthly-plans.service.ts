import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'
import { calcFreeCash } from '@/modules/monthly-plans/domain/monthly-split.calculator'
import { calcStashDelta } from '@/modules/monthly-plans/domain/stash.calculator'
import {
  IMonthlyPlanRepository,
  MONTHLY_PLAN_REPOSITORY,
} from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'
import { z } from 'zod'

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
  ) {}

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

  async upsert(tenantId: string, actorId: string, dto: UpsertMonthlyPlanDto) {
    return this.repository.runInTransaction(async (tx) => {
      const existing = await tx.findCurrent(tenantId, dto.month, dto.year)

      const oldFreeCash = existing
        ? calcFreeCash({
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

      const mergedLoanPayments = this.normalizeLoanPayments(
        dto.loanPayments ?? (existing?.loanPayments as unknown[]) ?? [],
      )
      const mergedCustomExpenses = this.normalizeCustomExpenses(
        dto.customExpenses ?? (existing?.customExpenses as unknown[]) ?? [],
      )
      const newFreeCash = calcFreeCash({
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
      const stashDelta = calcStashDelta(oldFreeCash, newFreeCash)

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

      const currentSetting = await tx.findSetting(tenantId)
      if (currentSetting) {
        await tx.updateSetting(tenantId, {
            stashBalance: this.toNumber(currentSetting.stashBalance) + stashDelta,
            updatedBy: actorId,
        })
      } else {
        await tx.createSetting({
            id: `pst_${tenantId}`,
            tenantId,
            stashBalance: stashDelta,
            createdBy: actorId,
            updatedBy: actorId,
        })
      }
      return saved
    })
  }
}
