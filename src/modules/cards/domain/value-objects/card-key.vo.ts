import { DomainError } from '@/shared/domain/domain.error'

export class CardKey {
  private constructor(public readonly value: string) {}

  static create(raw: string): CardKey {
    const normalized = String(raw ?? '').trim().toUpperCase()
    if (!normalized) throw new DomainError('Card key is required', 'INVALID_CARD_KEY')
    return new CardKey(normalized)
  }
}
