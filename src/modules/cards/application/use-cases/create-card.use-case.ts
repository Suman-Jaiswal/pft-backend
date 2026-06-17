import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { UseCase } from '@/shared/application/use-case'
import { CARD_REPOSITORY, ICardRepository } from '@/modules/cards/domain/repositories/card.repository'
import { CardEntity, CardStatus } from '@/modules/cards/domain/entities/card.entity'
import { CardKey } from '@/modules/cards/domain/value-objects/card-key.vo'
import { CreateCardCommand } from '@/modules/cards/application/dto/create-card.command'

function deriveLast4FromCardKey(cardKey: string): string | null {
  const match = cardKey.match(/_(?:XX)?(\d{4})$/)
  return match?.[1] ?? null
}

const schema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  cardKey: z.string().min(1),
  issuer: z.string().min(1),
  last4: z.string().optional(),
  network: z.string().optional(),
  statementCycleDay: z.number().int().min(1).max(31).optional(),
  creditLimit: z.number().min(0).optional(),
  fullCardNumber: z.string().optional(),
  cvv: z.string().optional(),
  expiryDate: z.string().optional(),
})

@Injectable()
export class CreateCardUseCase implements UseCase<CreateCardCommand, CardEntity> {
  constructor(@Inject(CARD_REPOSITORY) private readonly repository: ICardRepository) {}

  async execute(input: CreateCardCommand): Promise<CardEntity> {
    const cmd = schema.parse(input)
    const now = new Date()
    const id = `card_${randomUUID()}`
    const cardKey = CardKey.create(cmd.cardKey)
    const entity = new CardEntity(
      id,
      cmd.tenantId,
      now,
      now,
      cmd.actorId,
      cmd.actorId,
      cardKey,
      cmd.issuer,
      cmd.last4 ?? deriveLast4FromCardKey(cardKey.value) ?? null,
      cmd.network ?? null,
      cmd.statementCycleDay ?? null,
      cmd.creditLimit ?? null,
      CardStatus.ACTIVE,
      cmd.fullCardNumber ?? null,
      cmd.cvv ?? null,
      cmd.expiryDate ?? null,
    )
    return this.repository.create(entity)
  }
}
