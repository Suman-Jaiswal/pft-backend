import { TransactionEntity } from '@/modules/transactions/domain/entities/transaction.entity'
import { AdjustmentType } from '@/modules/transactions/domain/effective-amount'

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
  items: TransactionListItem[]
  total: number
  hasMore?: boolean
  nextCursor?: string | null
}

export type TransactionListItem = Omit<TransactionEntity, 'amount'> & {
  amount: number
  adjustment: {
    type: AdjustmentType
    personalShare: number | null
    amortizeMonths: number | null
    monthlyAmount: number | null
    note: string | null
  } | null
}

export interface ITransactionRepository {
  create(txn: TransactionEntity): Promise<TransactionEntity>
  findById(tenantId: string, id: string): Promise<TransactionEntity | null>
  list(query: TransactionQuery): Promise<TransactionListResult>
  update(txn: TransactionEntity): Promise<TransactionEntity>
  delete(tenantId: string, id: string): Promise<void>
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY')
