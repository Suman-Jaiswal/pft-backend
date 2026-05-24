import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { ok } from '@/shared/presentation/api-response'
import { MonthlyPlansService } from '@/modules/monthly-plans/monthly-plans.service'
import { CurrentMonthlyPlanQueryDto } from '@/modules/monthly-plans/dto/current-monthly-plan.query.dto'
import { UpsertMonthlyPlanDto } from '@/modules/monthly-plans/dto/upsert-monthly-plan.dto'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('monthly-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'monthly-plans', version: '1' })
export class MonthlyPlansController {
  constructor(private readonly service: MonthlyPlansService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async list(@Req() req: ReqUser) {
    return ok(await this.service.list(req.user.tenantId))
  }

  @Get('current')
  @Roles(Role.ADMIN, Role.USER)
  async current(@Req() req: ReqUser, @Query() query: CurrentMonthlyPlanQueryDto) {
    return ok(await this.service.getCurrent(req.user.tenantId, Number(query.month), Number(query.year)))
  }

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  async upsert(@Req() req: ReqUser, @Body() dto: UpsertMonthlyPlanDto) {
    return ok(await this.service.upsert(req.user.tenantId, req.user.sub, dto))
  }
}
