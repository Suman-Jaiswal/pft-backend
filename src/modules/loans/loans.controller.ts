import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { ok } from '@/shared/presentation/api-response'
import { LoansService } from '@/modules/loans/loans.service'
import { UpsertLoanDto } from '@/modules/loans/dto/upsert-loan.dto'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'loans', version: '1' })
export class LoansController {
  constructor(private readonly service: LoansService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async list(@Req() req: ReqUser) {
    return ok(await this.service.list(req.user.tenantId))
  }

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  async upsert(@Req() req: ReqUser, @Body() dto: UpsertLoanDto) {
    return ok(await this.service.upsert(req.user.tenantId, req.user.sub, dto))
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.USER)
  async status(@Req() req: ReqUser, @Param('id') id: string, @Body() body: { status: string }) {
    await this.service.transitionStatus(req.user.tenantId, req.user.sub, id, body.status)
    return ok(true)
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.USER)
  async remove(@Req() req: ReqUser, @Param('id') id: string) {
    await this.service.remove(req.user.tenantId, id)
    return ok(true)
  }
}
