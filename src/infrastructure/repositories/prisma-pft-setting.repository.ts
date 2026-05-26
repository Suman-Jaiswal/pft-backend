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
    Number(row.defaultOtherIncome),
    Number(row.defaultRent),
    Number(row.defaultCook),
    Number(row.defaultLoanRepayment),
    Number(row.defaultSip),
    Number(row.defaultInvestment),
    Number(row.defaultLiquidSaved),
    Number(row.defaultBills),
    Number(row.defaultBasicExpenses),
    Number(row.defaultOtherExpenses),
    Number(row.prevLiquidBalance),
    Number(row.prevInvestmentBalance),
    Number(row.stashBalance ?? 0),
    row.dashboardYearRange,
    Number(row.dashboardBaselineVersion ?? 1),
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
        defaultOtherIncome: setting.defaultOtherIncome,
        defaultRent: setting.defaultRent,
        defaultCook: setting.defaultCook,
        defaultLoanRepayment: setting.defaultLoanRepayment,
        defaultSip: setting.defaultSip,
        defaultInvestment: setting.defaultInvestment,
        defaultLiquidSaved: setting.defaultLiquidSaved,
        defaultBills: setting.defaultBills,
        defaultBasicExpenses: setting.defaultBasicExpenses,
        defaultOtherExpenses: setting.defaultOtherExpenses,
        prevLiquidBalance: setting.prevLiquidBalance,
        prevInvestmentBalance: setting.prevInvestmentBalance,
        stashBalance: setting.stashBalance,
        dashboardYearRange: setting.dashboardYearRange ?? undefined,
        dashboardBaselineVersion: setting.dashboardBaselineVersion,
        updatedBy: setting.updatedBy,
      },
      create: {
        id: setting.id,
        tenantId: setting.tenantId,
        currency: setting.currency,
        defaultSalary: setting.defaultSalary,
        defaultOtherIncome: setting.defaultOtherIncome,
        defaultRent: setting.defaultRent,
        defaultCook: setting.defaultCook,
        defaultLoanRepayment: setting.defaultLoanRepayment,
        defaultSip: setting.defaultSip,
        defaultInvestment: setting.defaultInvestment,
        defaultLiquidSaved: setting.defaultLiquidSaved,
        defaultBills: setting.defaultBills,
        defaultBasicExpenses: setting.defaultBasicExpenses,
        defaultOtherExpenses: setting.defaultOtherExpenses,
        prevLiquidBalance: setting.prevLiquidBalance,
        prevInvestmentBalance: setting.prevInvestmentBalance,
        stashBalance: setting.stashBalance,
        dashboardYearRange: setting.dashboardYearRange ?? undefined,
        dashboardBaselineVersion: setting.dashboardBaselineVersion,
        createdBy: setting.createdBy,
        updatedBy: setting.updatedBy,
      },
    })
    return toEntity(row)
  }
}
