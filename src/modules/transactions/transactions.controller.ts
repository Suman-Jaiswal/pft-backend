import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { TransactionsService } from '@/modules/transactions/transactions.service'
import { CreateTransactionDto } from '@/modules/transactions/presentation/dto/create-transaction.dto'
import { UpdateTransactionDto } from '@/modules/transactions/presentation/dto/update-transaction.dto'
import { ok } from '@/shared/presentation/api-response'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'transactions', version: '1' })
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  async create(@Req() req: ReqUser, @Body() dto: CreateTransactionDto) {
    return ok(await this.transactionsService.create(req.user.tenantId, req.user.sub, dto))
  }

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  @ApiQuery({ name: 'page', required: false, type: String })
  @ApiQuery({ name: 'pageSize', required: false, type: String })
  @ApiQuery({ name: 'cardId', required: false, type: String })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  async list(
    @Req() req: ReqUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('cardId') cardId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return ok(
      await this.transactionsService.list(
        req.user.tenantId,
        Number(page),
        Number(pageSize),
        cardId,
        fromDate,
        toDate,
      ),
    )
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.USER)
  async get(@Req() req: ReqUser, @Param('id') id: string) {
    return ok(await this.transactionsService.get(req.user.tenantId, id))
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.USER)
  async update(@Req() req: ReqUser, @Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return ok(await this.transactionsService.update(req.user.tenantId, req.user.sub, id, dto))
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.USER)
  async remove(@Req() req: ReqUser, @Param('id') id: string) {
    await this.transactionsService.remove(req.user.tenantId, id)
    return ok({ id })
  }
}
