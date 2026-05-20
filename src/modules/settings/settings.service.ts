import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'
import {
  IPftSettingRepository,
  PFT_SETTING_REPOSITORY,
} from '@/modules/settings/domain/repositories/pft-setting.repository'
import { UpdatePftSettingsDto } from '@/modules/settings/presentation/dto/update-pft-settings.dto'

@Injectable()
export class SettingsService {
  constructor(@Inject(PFT_SETTING_REPOSITORY) private readonly repository: IPftSettingRepository) {}

  async getPftSettings(tenantId: string): Promise<PftSettingEntity> {
    const existing = await this.repository.findByTenantId(tenantId)
    if (existing) return existing
    const now = new Date()
    const defaults = new PftSettingEntity(
      `pst_${randomUUID()}`,
      tenantId,
      now,
      now,
      'system',
      'system',
      'INR',
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      null,
    )
    return this.repository.upsert(defaults)
  }

  async updatePftSettings(
    tenantId: string,
    actorId: string,
    dto: UpdatePftSettingsDto,
  ): Promise<PftSettingEntity> {
    const current = await this.getPftSettings(tenantId)
    const updated = new PftSettingEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      dto.currency ?? current.currency,
      dto.defaultSalary ?? current.defaultSalary,
      dto.defaultOtherIncome ?? current.defaultOtherIncome,
      dto.defaultRent ?? current.defaultRent,
      dto.defaultCook ?? current.defaultCook,
      dto.defaultLoanRepayment ?? current.defaultLoanRepayment,
      dto.defaultSip ?? current.defaultSip,
      dto.defaultInvestment ?? current.defaultInvestment,
      dto.defaultLiquidSaved ?? current.defaultLiquidSaved,
      dto.defaultBills ?? current.defaultBills,
      dto.defaultBasicExpenses ?? current.defaultBasicExpenses,
      dto.defaultOtherExpenses ?? current.defaultOtherExpenses,
      dto.prevLiquidBalance ?? current.prevLiquidBalance,
      dto.prevInvestmentBalance ?? current.prevInvestmentBalance,
      dto.dashboardYearRange ?? current.dashboardYearRange,
    )
    return this.repository.upsert(updated)
  }
}
