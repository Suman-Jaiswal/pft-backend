import { BaseEntity } from '@/shared/domain/base.entity'
import { Money } from '@/modules/transactions/domain/value-objects/money.vo'

export class TransactionEntity extends BaseEntity {
  constructor(
    id: string,
    tenantId: string,
    createdAt: Date,
    updatedAt: Date,
    createdBy: string,
    updatedBy: string,
    public readonly cardId: string,
    public readonly statementId: string | null,
    public readonly txnDate: Date,
    public readonly txnTimestamp: Date | null,
    public readonly amount: Money,
    public readonly merchant: string,
    public readonly channel: string,
    public readonly bankKey: string | null,
    public readonly emailId: string | null,
    public readonly dedupeKey: string | null,
    public readonly importedAt: Date | null,
    public readonly referenceNo: string | null,
    public readonly externalId: string | null,
  ) {
    super(id, tenantId, createdAt, updatedAt, createdBy, updatedBy)
  }
}
