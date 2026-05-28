import { Injectable } from '@nestjs/common'
import { PftSetting } from '@prisma/client'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'
import { IPftSettingRepository } from '@/modules/settings/domain/repositories/pft-setting.repository'

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
    Number(row.defaultFd),
    Number(row.defaultSavings),
    Number(row.defaultBills),
    Number(row.defaultBasicExpenses),
    Number(row.defaultOtherExpenses),
    Number(row.prevLiquidBalance),
    Number(row.prevInvestmentBalance),
    Number(row.stashBalance ?? 0),
    row.dashboardYearRange,
    Number(row.dashboardBaselineVersion ?? 1),
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
        defaultSavings: setting.defaultSavings,
        defaultBills: setting.defaultBills,
        defaultBasicExpenses: setting.defaultBasicExpenses,
        defaultOtherExpenses: setting.defaultOtherExpenses,
        prevLiquidBalance: setting.prevLiquidBalance,
        prevInvestmentBalance: setting.prevInvestmentBalance,
        stashBalance: setting.stashBalance,
        dashboardYearRange: setting.dashboardYearRange ?? undefined,
        dashboardBaselineVersion: setting.dashboardBaselineVersion,
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
        defaultSavings: setting.defaultSavings,
        defaultBills: setting.defaultBills,
        defaultBasicExpenses: setting.defaultBasicExpenses,
        defaultOtherExpenses: setting.defaultOtherExpenses,
        prevLiquidBalance: setting.prevLiquidBalance,
        prevInvestmentBalance: setting.prevInvestmentBalance,
        stashBalance: setting.stashBalance,
        dashboardYearRange: setting.dashboardYearRange ?? undefined,
        dashboardBaselineVersion: setting.dashboardBaselineVersion,
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
