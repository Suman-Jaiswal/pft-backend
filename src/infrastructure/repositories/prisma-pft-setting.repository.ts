import { Injectable } from '@nestjs/common'
import { PftSetting } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'
import { IPftSettingRepository } from '@/modules/settings/domain/repositories/pft-setting.repository'

function fdPacket(value: unknown): { amount: number; quantity: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { amount: 0, quantity: 0 }
  const row = value as Record<string, unknown>
  return { amount: Number(row.amount) || 0, quantity: Number(row.quantity) || 0 }
}

function goalPayments(value: unknown): Array<{ id: string; name: string; amount: number }> {
  return Array.isArray(value)
    ? (value as Array<{ id: string; name: string; amount: number }>)
    : []
}

function toEntity(row: PftSetting): PftSettingEntity {
  return new PftSettingEntity(
    row.id,
    row.tenantId,
    row.createdAt,
    row.updatedAt,
    row.createdBy,
    row.updatedBy,
    row.currency,
    Number(row.defaultSalary),
    Number(row.defaultOtherSources),
    Number(row.defaultRent),
    Number(row.defaultCook),
    Number(row.defaultLoanRepayment),
    Number(row.defaultSipMf),
    Number(row.defaultStocks),
    fdPacket(row.defaultFd),
    goalPayments(row.defaultGoalPayments),
    Number(row.defaultSavings),
    Number(row.defaultStash),
    Number(row.defaultBills),
    Number(row.defaultBasicExpenses),
    Number(row.defaultOtherExpenses),
    Number(row.prevLiquidBalance),
    Number(row.prevInvestmentBalance),
    Number(row.stashDeductions ?? 0),
    row.dashboardYearRange,
    Number(row.dashboardBaselineVersion ?? 1),
    Array.isArray(row.planDefaultSlates) ? row.planDefaultSlates : null,
    row.importGmailRefreshToken,
    row.importGmailEmail,
    row.importGmailScope,
    row.importGmailTokenUpdatedAt,
  )
}

@Injectable()
export class PrismaPftSettingRepository implements IPftSettingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantId(tenantId: string): Promise<PftSettingEntity | null> {
    const row = await this.prisma.pftSetting.findUnique({ where: { tenantId } })
    return row ? toEntity(row) : null
  }

  async upsert(setting: PftSettingEntity): Promise<PftSettingEntity> {
    const row = await this.prisma.pftSetting.upsert({
      where: { tenantId: setting.tenantId },
      update: {
        currency: setting.currency,
        defaultSalary: setting.defaultSalary,
        defaultOtherSources: setting.defaultOtherSources,
        defaultRent: setting.defaultRent,
        defaultCook: setting.defaultCook,
        defaultLoanRepayment: setting.defaultLoanRepayment,
        defaultSipMf: setting.defaultSipMf,
        defaultStocks: setting.defaultStocks,
        defaultFd: setting.defaultFd,
        defaultGoalPayments: setting.defaultGoalPayments,
        defaultSavings: setting.defaultSavings,
        defaultStash: setting.defaultStash,
        defaultBills: setting.defaultBills,
        defaultBasicExpenses: setting.defaultBasicExpenses,
        defaultOtherExpenses: setting.defaultOtherExpenses,
        prevLiquidBalance: setting.prevLiquidBalance,
        prevInvestmentBalance: setting.prevInvestmentBalance,
        stashDeductions: setting.stashDeductions,
        dashboardYearRange: setting.dashboardYearRange ?? undefined,
        dashboardBaselineVersion: setting.dashboardBaselineVersion,
        planDefaultSlates: (setting.planDefaultSlates ?? undefined) as object | undefined,
        importGmailRefreshToken: setting.importGmailRefreshToken ?? undefined,
        importGmailEmail: setting.importGmailEmail ?? undefined,
        importGmailScope: setting.importGmailScope ?? undefined,
        importGmailTokenUpdatedAt: setting.importGmailTokenUpdatedAt ?? undefined,
        updatedBy: setting.updatedBy,
      },
      create: {
        id: setting.id,
        tenantId: setting.tenantId,
        currency: setting.currency,
        defaultSalary: setting.defaultSalary,
        defaultOtherSources: setting.defaultOtherSources,
        defaultRent: setting.defaultRent,
        defaultCook: setting.defaultCook,
        defaultLoanRepayment: setting.defaultLoanRepayment,
        defaultSipMf: setting.defaultSipMf,
        defaultStocks: setting.defaultStocks,
        defaultFd: setting.defaultFd,
        defaultGoalPayments: setting.defaultGoalPayments,
        defaultSavings: setting.defaultSavings,
        defaultStash: setting.defaultStash,
        defaultBills: setting.defaultBills,
        defaultBasicExpenses: setting.defaultBasicExpenses,
        defaultOtherExpenses: setting.defaultOtherExpenses,
        prevLiquidBalance: setting.prevLiquidBalance,
        prevInvestmentBalance: setting.prevInvestmentBalance,
        stashDeductions: setting.stashDeductions,
        dashboardYearRange: setting.dashboardYearRange ?? undefined,
        dashboardBaselineVersion: setting.dashboardBaselineVersion,
        planDefaultSlates: (setting.planDefaultSlates ?? undefined) as object | undefined,
        importGmailRefreshToken: setting.importGmailRefreshToken ?? undefined,
        importGmailEmail: setting.importGmailEmail ?? undefined,
        importGmailScope: setting.importGmailScope ?? undefined,
        importGmailTokenUpdatedAt: setting.importGmailTokenUpdatedAt ?? undefined,
        createdBy: setting.createdBy,
        updatedBy: setting.updatedBy,
      },
    })
    return toEntity(row)
  }
}
