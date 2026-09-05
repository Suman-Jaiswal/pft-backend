import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { UpsertGoalDto } from '@/modules/goals/dto/upsert-goal.dto'
import { GoalsService } from '@/modules/goals/goals.service'
import { Role } from '@/shared/auth/role.enum'
import { Roles } from '@/shared/auth/roles.decorator'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { ok } from '@/shared/presentation/api-response'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('goals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'goals', version: '1' })
export class GoalsController {
  constructor(private readonly service: GoalsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'List goals [AUTH: JWT]' })
  async list(@Req() req: ReqUser) {
    return ok(await this.service.list(req.user.tenantId))
  }

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Upsert goal [AUTH: JWT]' })
  async upsert(@Req() req: ReqUser, @Body() dto: UpsertGoalDto) {
    return ok(await this.service.upsert(req.user.tenantId, req.user.sub, dto))
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Update goal status [AUTH: JWT]' })
  async status(
    @Req() req: ReqUser,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    await this.service.transitionStatus(req.user.tenantId, req.user.sub, id, body.status)
    return ok(true)
  }
}
