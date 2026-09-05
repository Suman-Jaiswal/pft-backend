import type { Prisma } from '@prisma/client'
import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'

export interface IPftSettingRepository {
  findByTenantId(tenantId: string): Promise<PftSettingEntity | null>
  upsert(setting: PftSettingEntity): Promise<PftSettingEntity>
  runInTransaction<T>(
    fn: (ctx: {
      transaction: Prisma.TransactionClient
      upsert: (setting: PftSettingEntity) => Promise<PftSettingEntity>
    }) => Promise<T>,
  ): Promise<T>
}

export const PFT_SETTING_REPOSITORY = Symbol('PFT_SETTING_REPOSITORY')
