import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { ok } from '@/shared/presentation/api-response'
import { MonthlyPlansService } from '@/modules/monthly-plans/monthly-plans.service'
import { CurrentMonthlyPlanQueryDto } from '@/modules/monthly-plans/dto/current-monthly-plan.query.dto'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'
import { DashboardOutlookQueryDto } from '@/modules/monthly-plans/dto/dashboard-outlook.query.dto'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('monthly-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'monthly-plans', version: '1' })
export class MonthlyPlansController {
  constructor(private readonly service: MonthlyPlansService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'List monthly plans [AUTH: JWT]' })
  async list(@Req() req: ReqUser) {
    return ok(await this.service.list(req.user.tenantId))
  }

  @Get('current')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get current monthly plan [AUTH: JWT]' })
  async current(@Req() req: ReqUser, @Query() query: CurrentMonthlyPlanQueryDto) {
    return ok(await this.service.getCurrent(req.user.tenantId, Number(query.month), Number(query.year)))
  }

  @Get('dashboard-summary')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get dashboard summary [AUTH: JWT]' })
  async dashboardSummary(@Req() req: ReqUser) {
    return ok(await this.service.getDashboardSummary(req.user.tenantId))
  }

  @Get('outlook')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get dashboard outlook plans [AUTH: JWT]' })
  async outlook(@Req() req: ReqUser, @Query() query: DashboardOutlookQueryDto) {
    return ok(await this.service.getOutlook(req.user.tenantId, query.period))
  }

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Upsert monthly plan [AUTH: JWT]' })
  async upsert(@Req() req: ReqUser, @Body() dto: UpsertMonthlyPlanDto) {
    return ok(await this.service.upsert(req.user.tenantId, req.user.sub, dto))
  }
}
