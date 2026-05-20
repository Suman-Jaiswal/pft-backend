import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { CARD_REPOSITORY, ICardRepository } from '@/modules/cards/domain/repositories/card.repository'
import { CreateCardUseCase } from '@/modules/cards/application/use-cases/create-card.use-case'
import { CreateCardDto } from '@/modules/cards/presentation/dto/create-card.dto'
import { UpdateCardDto } from '@/modules/cards/presentation/dto/update-card.dto'
import { CardEntity, CardStatus } from '@/modules/cards/domain/entities/card.entity'

@Injectable()
export class CardsService {
  constructor(
    @Inject(CARD_REPOSITORY) private readonly repository: ICardRepository,
    private readonly createCardUseCase: CreateCardUseCase,
  ) {}

  create(tenantId: string, actorId: string, dto: CreateCardDto): Promise<CardEntity> {
    return this.createCardUseCase.execute({ tenantId, actorId, ...dto })
  }

  async get(tenantId: string, id: string): Promise<CardEntity> {
    const card = await this.repository.findById(tenantId, id)
    if (!card) throw new NotFoundException('Card not found')
    return card
  }

  list(tenantId: string, page = 1, pageSize = 20) {
    return this.repository.list({ tenantId, page, pageSize })
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateCardDto): Promise<CardEntity> {
    const current = await this.get(tenantId, id)
    const updated = new CardEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      current.cardKey,
      dto.issuer ?? current.issuer,
      dto.last4 ?? current.last4,
      dto.network ?? current.network,
      dto.statementCycleDay ?? current.statementCycleDay,
      dto.creditLimit ?? current.creditLimit,
      (dto.status as CardStatus | undefined) ?? current.status,
    )
    return this.repository.update(updated)
  }

  async updateStatus(
    tenantId: string,
    actorId: string,
    id: string,
    status: CardStatus,
  ): Promise<CardEntity> {
    return this.update(tenantId, actorId, id, { status })
  }
}
