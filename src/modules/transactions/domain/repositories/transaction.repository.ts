import { TransactionEntity } from '@/modules/transactions/domain/entities/transaction.entity'

export interface TransactionQuery {
  tenantId: string
  cardId?: string
  fromDate?: Date
  toDate?: Date
  q?: string
  page: number
  pageSize: number
  limit?: number
  cursor?: string
}

export interface TransactionListResult {
  items: TransactionEntity[]
  total: number
  hasMore?: boolean
  nextCursor?: string | null
}

export interface ITransactionRepository {
  create(txn: TransactionEntity): Promise<TransactionEntity>
  findById(tenantId: string, id: string): Promise<TransactionEntity | null>
  list(query: TransactionQuery): Promise<TransactionListResult>
  update(txn: TransactionEntity): Promise<TransactionEntity>
  delete(tenantId: string, id: string): Promise<void>
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY')
