import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { StatementsService } from '@/modules/statements/statements.service'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { CreateStatementDto } from '@/modules/statements/presentation/dto/create-statement.dto'
import { UpdateStatementDto } from '@/modules/statements/presentation/dto/update-statement.dto'
import { ok } from '@/shared/presentation/api-response'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'statements', version: '1' })
export class StatementsController {
  constructor(private readonly statementsService: StatementsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  async create(@Req() req: ReqUser, @Body() dto: CreateStatementDto) {
    return ok(await this.statementsService.create(req.user.tenantId, req.user.sub, dto))
  }

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async list(
    @Req() req: ReqUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('cardId') cardId?: string,
    @Query('statementMonth') statementMonth?: string,
  ) {
    return ok(
      await this.statementsService.list(
        req.user.tenantId,
        Number(page),
        Number(pageSize),
        cardId,
        statementMonth,
      ),
    )
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.USER)
  async get(@Req() req: ReqUser, @Param('id') id: string) {
    return ok(await this.statementsService.get(req.user.tenantId, id))
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.USER)
  async update(@Req() req: ReqUser, @Param('id') id: string, @Body() dto: UpdateStatementDto) {
    return ok(await this.statementsService.update(req.user.tenantId, req.user.sub, id, dto))
  }

  @Post(':id/mark-paid')
  @Roles(Role.ADMIN, Role.USER)
  async markPaid(@Req() req: ReqUser, @Param('id') id: string) {
    return ok(await this.statementsService.markPaid(req.user.tenantId, req.user.sub, id))
  }
}
