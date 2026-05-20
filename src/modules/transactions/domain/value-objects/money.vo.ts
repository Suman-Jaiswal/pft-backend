import { DomainError } from '@/shared/domain/domain.error'

export class Money {
  private constructor(public readonly value: number) {}

  static create(raw: number): Money {
    if (!Number.isFinite(raw)) throw new DomainError('Amount must be finite', 'INVALID_AMOUNT')
    return new Money(raw)
  }
}
