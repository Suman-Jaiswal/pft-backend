import { BaseEntity } from '@/shared/domain/base.entity'
import { DomainError } from '@/shared/domain/domain.error'
import { CardKey } from '@/modules/cards/domain/value-objects/card-key.vo'

export enum CardStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  CLOSED = 'CLOSED',
}

export class CardEntity extends BaseEntity {
  constructor(
    id: string,
    tenantId: string,
    createdAt: Date,
    updatedAt: Date,
    createdBy: string,
    updatedBy: string,
    public readonly cardKey: CardKey,
    public readonly issuer: string,
    public readonly last4: string | null,
    public readonly network: string | null,
    public readonly statementCycleDay: number | null,
    public readonly creditLimit: number | null,
    public readonly status: CardStatus,
  ) {
    super(id, tenantId, createdAt, updatedAt, createdBy, updatedBy)
    if (statementCycleDay !== null && (statementCycleDay < 1 || statementCycleDay > 31)) {
      throw new DomainError('statementCycleDay must be 1..31', 'INVALID_STATEMENT_CYCLE_DAY')
    }
    if (creditLimit !== null && creditLimit < 0) {
      throw new DomainError('creditLimit cannot be negative', 'INVALID_CREDIT_LIMIT')
    }
  }
}
