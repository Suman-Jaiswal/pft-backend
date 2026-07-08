import { DomainError } from '@/shared/domain/domain.error'

export class StatementMonth {
  private constructor(public readonly value: string) {}

  static create(raw: string): StatementMonth {
    const normalized = String(raw ?? '').trim()
    if (!/^\d{4}-\d{2}$/.test(normalized)) {
      throw new DomainError('statementMonth must be YYYY-MM', 'INVALID_STATEMENT_MONTH')
    }
    return new StatementMonth(normalized)
  }

  toJSON(): string {
    return this.value
  }

  toString(): string {
    return this.value
  }
}
