import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { ok } from '@/shared/presentation/api-response'
import { BillsService } from '@/modules/bills/bills.service'
import { UpsertBillDto } from '@/modules/bills/dto/upsert-bill.dto'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('bills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'bills', version: '1' })
export class BillsController {
  constructor(private readonly service: BillsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async list(@Req() req: ReqUser) {
    return ok(await this.service.list(req.user.tenantId))
  }

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  async upsert(@Req() req: ReqUser, @Body() dto: UpsertBillDto) {
    return ok(await this.service.upsert(req.user.tenantId, req.user.sub, dto))
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.USER)
  async remove(@Req() req: ReqUser, @Param('id') id: string) {
    await this.service.remove(req.user.tenantId, id)
    return ok(true)
  }
}
