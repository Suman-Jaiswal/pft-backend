import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { ok } from '@/shared/presentation/api-response'
import { SettingsService } from '@/modules/settings/settings.service'
import { UpdatePftSettingsDto } from '@/modules/settings/presentation/dto/update-pft-settings.dto'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'settings/pft', version: '1' })
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async get(@Req() req: ReqUser) {
    return ok(await this.settingsService.getPftSettings(req.user.tenantId))
  }

  @Patch()
  @Roles(Role.ADMIN, Role.USER)
  async patch(@Req() req: ReqUser, @Body() dto: UpdatePftSettingsDto) {
    return ok(await this.settingsService.updatePftSettings(req.user.tenantId, req.user.sub, dto))
  }
}
