import { DomainError } from '@/shared/domain/domain.error'

function toCanonicalCardKey(raw: string): string {
  const normalized = String(raw ?? '').trim().toUpperCase()
  const maskedOrPlain = normalized.match(/^([A-Z0-9]+)_(?:XX)?(\d{4})$/)
  if (!maskedOrPlain) return normalized
  const [, issuer, last4] = maskedOrPlain
  return `${issuer}_XX${last4}`
}

export class CardKey {
  private constructor(public readonly value: string) {}

  static create(raw: string): CardKey {
    const normalized = toCanonicalCardKey(raw)
    if (!normalized) throw new DomainError('Card key is required', 'INVALID_CARD_KEY')
    return new CardKey(normalized)
  }

  toJSON(): string {
    return this.value
  }

  toString(): string {
    return this.value
  }
}
