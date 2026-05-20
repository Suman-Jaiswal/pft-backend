import { TransactionEntity } from '@/modules/transactions/domain/entities/transaction.entity'

export interface TransactionQuery {
  tenantId: string
  cardId?: string
  fromDate?: Date
  toDate?: Date
  page: number
  pageSize: number
}

export interface ITransactionRepository {
  create(txn: TransactionEntity): Promise<TransactionEntity>
  findById(tenantId: string, id: string): Promise<TransactionEntity | null>
  list(query: TransactionQuery): Promise<{ items: TransactionEntity[]; total: number }>
  update(txn: TransactionEntity): Promise<TransactionEntity>
  delete(tenantId: string, id: string): Promise<void>
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY')
