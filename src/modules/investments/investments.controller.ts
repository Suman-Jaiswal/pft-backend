import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { ok } from '@/shared/presentation/api-response'
import { SellInvestmentDto } from '@/modules/investments/dto/sell-investment.dto'
import { InvestmentsService } from '@/modules/investments/investments.service'

type ReqUser = { user: { sub: string; tenantId: string } }

export enum InvestmentRouteAsset {
  MF = 'mf',
  STOCKS = 'stocks',
}

@ApiTags('investments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'investments', version: '1' })
export class InvestmentsController {
  constructor(private readonly service: InvestmentsService) {}

  @Get('summary')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Get investment balances [AUTH: JWT]' })
  async summary(@Req() req: ReqUser) {
    return ok(await this.service.summarize(req.user.tenantId))
  }

  @Get(':asset/transactions')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'List investment purchase and sale transactions [AUTH: JWT]' })
  async listTransactions(
    @Req() req: ReqUser,
    @Param('asset', new ParseEnumPipe(InvestmentRouteAsset)) asset: InvestmentRouteAsset,
  ) {
    return ok(await this.service.listTransactions(req.user.tenantId, asset))
  }

  @Post(':asset/sell')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Sell from an investment balance [AUTH: JWT]' })
  async sell(
    @Req() req: ReqUser,
    @Param('asset', new ParseEnumPipe(InvestmentRouteAsset)) asset: InvestmentRouteAsset,
    @Body() dto: SellInvestmentDto,
  ) {
    return ok(await this.service.sell(req.user.tenantId, req.user.sub, asset, dto.amount))
  }

  @Delete('sales/:saleId')
  @Roles(Role.ADMIN, Role.USER)
  @ApiOperation({ summary: 'Undo an investment sale [AUTH: JWT]' })
  async undoSale(@Req() req: ReqUser, @Param('saleId') saleId: string) {
    return ok(await this.service.undoSale(req.user.tenantId, saleId))
  }
}
