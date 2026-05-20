import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'

export interface IPftSettingRepository {
  findByTenantId(tenantId: string): Promise<PftSettingEntity | null>
  upsert(setting: PftSettingEntity): Promise<PftSettingEntity>
}

export const PFT_SETTING_REPOSITORY = Symbol('PFT_SETTING_REPOSITORY')
