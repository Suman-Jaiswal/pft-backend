import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'
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
}
