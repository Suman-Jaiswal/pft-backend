import { Module } from '@nestjs/common'
import { SettingsController } from '@/modules/settings/settings.controller'
import { SettingsService } from '@/modules/settings/settings.service'
import { PFT_SETTING_REPOSITORY } from '@/modules/settings/domain/repositories/pft-setting.repository'
import { PrismaPftSettingRepository } from '@/infrastructure/repositories/prisma-pft-setting.repository'

@Module({
  controllers: [SettingsController],
  providers: [
    SettingsService,
    { provide: PFT_SETTING_REPOSITORY, useClass: PrismaPftSettingRepository },
  ],
})
export class SettingsModule {}
