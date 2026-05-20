import { CardEntity } from '@/modules/cards/domain/entities/card.entity'

export interface CardQuery {
  tenantId: string
  page: number
  pageSize: number
}

export interface ICardRepository {
  create(card: CardEntity): Promise<CardEntity>
  findById(tenantId: string, id: string): Promise<CardEntity | null>
  findByCardKey(tenantId: string, cardKey: string): Promise<CardEntity | null>
  list(query: CardQuery): Promise<{ items: CardEntity[]; total: number }>
  update(card: CardEntity): Promise<CardEntity>
}

export const CARD_REPOSITORY = Symbol('CARD_REPOSITORY')
