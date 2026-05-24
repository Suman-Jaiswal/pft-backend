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
import { CardsService } from '@/modules/cards/cards.service'
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { Roles } from '@/shared/auth/roles.decorator'
import { Role } from '@/shared/auth/role.enum'
import { CreateCardDto } from '@/modules/cards/presentation/dto/create-card.dto'
import { ListCardsQueryDto } from '@/modules/cards/presentation/dto/list-cards.query.dto'
import { UpdateCardDto } from '@/modules/cards/presentation/dto/update-card.dto'
import { ok } from '@/shared/presentation/api-response'
import { CardStatus } from '@/modules/cards/domain/entities/card.entity'

type ReqUser = { user: { sub: string; tenantId: string } }

@ApiTags('cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'cards', version: '1' })
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.USER)
  async create(@Req() req: ReqUser, @Body() dto: CreateCardDto) {
    return ok(await this.cardsService.create(req.user.tenantId, req.user.sub, dto))
  }

  @Get()
  @Roles(Role.ADMIN, Role.USER)
  async list(@Req() req: ReqUser, @Query() query: ListCardsQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    return ok(await this.cardsService.list(req.user.tenantId, Number(page), Number(pageSize)))
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.USER)
  async get(@Req() req: ReqUser, @Param('id') id: string) {
    return ok(await this.cardsService.get(req.user.tenantId, id))
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.USER)
  async update(@Req() req: ReqUser, @Param('id') id: string, @Body() dto: UpdateCardDto) {
    return ok(await this.cardsService.update(req.user.tenantId, req.user.sub, id, dto))
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.USER)
  async updateStatus(
    @Req() req: ReqUser,
    @Param('id') id: string,
    @Body() dto: { status: 'ACTIVE' | 'INACTIVE' | 'CLOSED' },
  ) {
    const status = dto.status as CardStatus
    return ok(await this.cardsService.updateStatus(req.user.tenantId, req.user.sub, id, status))
  }
}
