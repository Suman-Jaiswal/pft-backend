import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { ok } from '@/shared/presentation/api-response'
import { SettingsService } from '@/modules/settings/settings.service'
import { UpdatePftSettingsDto } from '@/modules/settings/presentation/dto/update-pft-settings.dto'
import { ListPftBaselinesQueryDto } from '@/modules/settings/presentation/dto/list-pft-baselines.query.dto'
import { CreatePftBaselineDto } from '@/modules/settings/presentation/dto/create-pft-baseline.dto'
import { GetPftBaselineQueryDto } from '@/modules/settings/presentation/dto/get-pft-baseline.query.dto'
import { DeductStashDto } from '@/modules/settings/presentation/dto/deduct-stash.dto'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'settings/pft', version: '1' })
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get settings [AUTH: JWT]' })
  async get(@Req() req: ReqUser) {
    return ok(await this.settingsService.getPftSettingsWithComputedStash(req.user.tenantId))
  }

  @Patch()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Patch settings [AUTH: JWT]' })
  async patch(@Req() req: ReqUser, @Body() dto: UpdatePftSettingsDto) {
    return ok(await this.settingsService.updatePftSettings(req.user.tenantId, req.user.sub, dto))
  }

  @Get('baselines')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'List baselines [AUTH: JWT]' })
  async listBaselines(@Req() req: ReqUser, @Query() query: ListPftBaselinesQueryDto) {
    return ok(await this.settingsService.listBaselines(req.user.tenantId, query.periodKey))
  }

  @Get('baselines/selected')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get selected baseline [AUTH: JWT]' })
  async getBaseline(@Req() req: ReqUser, @Query() query: GetPftBaselineQueryDto) {
    return ok(
      await this.settingsService.getBaselineForVersion(
        req.user.tenantId,
        query.periodKey,
        typeof query.version === 'number' ? query.version : undefined,
      ),
    )
  }

  @Post('baselines')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Create baseline [AUTH: JWT]' })
  async createBaseline(@Req() req: ReqUser, @Body() dto: CreatePftBaselineDto) {
    return ok(
      await this.settingsService.createBaseline(req.user.tenantId, req.user.sub, {
        periodKey: dto.periodKey,
        source: dto.source,
        lockedBy: dto.lockedBy,
        metrics: dto.metrics,
      }),
    )
  }

  @Post('stash/deduct')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Deduct stash [AUTH: JWT]' })
  async deductStash(@Req() req: ReqUser, @Body() dto: DeductStashDto) {
    return ok(await this.settingsService.deductStash(req.user.tenantId, req.user.sub, dto.amount))
  }

  @Get('stash/balance')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get computed stash balance [AUTH: JWT]' })
  async getStashBalance(@Req() req: ReqUser) {
    const settings = await this.settingsService.getPftSettingsWithComputedStash(req.user.tenantId)
    return ok(settings.computedStashBalance)
  }
}
