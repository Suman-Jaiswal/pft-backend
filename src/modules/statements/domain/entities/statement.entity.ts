import { BaseEntity } from '@/shared/domain/base.entity'
import { DomainError } from '@/shared/domain/domain.error'
import { StatementMonth } from '@/modules/statements/domain/value-objects/statement-month.vo'

export enum StatementStatus {
  DUE = 'DUE',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export class StatementEntity extends BaseEntity {
  constructor(
    id: string,
    tenantId: string,
    createdAt: Date,
    updatedAt: Date,
    createdBy: string,
    updatedBy: string,
    public readonly cardId: string,
    public readonly cardKey: string,
    public readonly statementMonth: StatementMonth,
    public readonly dueDate: Date,
    public readonly minimumAmountDue: number,
    public readonly totalAmountDue: number,
    public readonly status: StatementStatus,
    public readonly statementSyncMonth: string | null,
  ) {
    super(id, tenantId, createdAt, updatedAt, createdBy, updatedBy)
    if (minimumAmountDue < 0 || totalAmountDue < 0) {
      throw new DomainError('Statement amounts cannot be negative', 'INVALID_STATEMENT_AMOUNT')
    }
  }
}
