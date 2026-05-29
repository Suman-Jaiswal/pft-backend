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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { TransactionsService } from '@/modules/transactions/transactions.service'
import { CreateTransactionDto } from '@/modules/transactions/presentation/dto/create-transaction.dto'
import { ListTransactionsQueryDto } from '@/modules/transactions/presentation/dto/list-transactions.query.dto'
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
  @ApiOperation({ summary: 'Create transaction [AUTH: JWT]' })
  async create(@Req() req: ReqUser, @Body() dto: CreateTransactionDto) {
    return ok(await this.transactionsService.create(req.user.tenantId, req.user.sub, dto))
  }

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'List transactions [AUTH: JWT]' })
  async list(@Req() req: ReqUser, @Query() query: ListTransactionsQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    return ok(
      await this.transactionsService.list(
        req.user.tenantId,
        Number(page),
        Number(pageSize),
        query.cardId,
        query.fromDate,
        query.toDate,
      ),
    )
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get transaction [AUTH: JWT]' })
  async get(@Req() req: ReqUser, @Param('id') id: string) {
    return ok(await this.transactionsService.get(req.user.tenantId, id))
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Update transaction [AUTH: JWT]' })
  async update(@Req() req: ReqUser, @Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return ok(await this.transactionsService.update(req.user.tenantId, req.user.sub, id, dto))
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Delete transaction [AUTH: JWT]' })
  async remove(@Req() req: ReqUser, @Param('id') id: string) {
    await this.transactionsService.remove(req.user.tenantId, id)
    return ok({ id })
  }
}
