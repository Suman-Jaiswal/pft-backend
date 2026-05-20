import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import {
  ITransactionRepository,
  TRANSACTION_REPOSITORY,
} from '@/modules/transactions/domain/repositories/transaction.repository'
import { TransactionEntity } from '@/modules/transactions/domain/entities/transaction.entity'
import { Money } from '@/modules/transactions/domain/value-objects/money.vo'
import { CreateTransactionDto } from '@/modules/transactions/presentation/dto/create-transaction.dto'
import { UpdateTransactionDto } from '@/modules/transactions/presentation/dto/update-transaction.dto'

@Injectable()
export class TransactionsService {
  constructor(@Inject(TRANSACTION_REPOSITORY) private readonly repository: ITransactionRepository) {}

  create(tenantId: string, actorId: string, dto: CreateTransactionDto): Promise<TransactionEntity> {
    const now = new Date()
    const entity = new TransactionEntity(
      `txn_${randomUUID()}`,
      tenantId,
      now,
      now,
      actorId,
      actorId,
      dto.cardId,
      dto.statementId ?? null,
      new Date(dto.txnDate),
      dto.txnTimestamp ? new Date(dto.txnTimestamp) : null,
      Money.create(dto.amount),
      dto.merchant,
      dto.channel,
      dto.bankKey ?? null,
      dto.emailId ?? null,
      dto.dedupeKey ?? null,
      dto.importedAt ? new Date(dto.importedAt) : null,
      dto.referenceNo ?? null,
      dto.externalId ?? null,
    )
    return this.repository.create(entity)
  }

  async get(tenantId: string, id: string): Promise<TransactionEntity> {
    const row = await this.repository.findById(tenantId, id)
    if (!row) throw new NotFoundException('Transaction not found')
    return row
  }

  list(
    tenantId: string,
    page = 1,
    pageSize = 20,
    cardId?: string,
    fromDate?: string,
    toDate?: string,
  ) {
    return this.repository.list({
      tenantId,
      page,
      pageSize,
      cardId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    })
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionEntity> {
    const current = await this.get(tenantId, id)
    const entity = new TransactionEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      current.cardId,
      dto.statementId ?? current.statementId,
      dto.txnDate ? new Date(dto.txnDate) : current.txnDate,
      dto.txnTimestamp ? new Date(dto.txnTimestamp) : current.txnTimestamp,
      dto.amount !== undefined ? Money.create(dto.amount) : current.amount,
      dto.merchant ?? current.merchant,
      dto.channel ?? current.channel,
      dto.bankKey ?? current.bankKey,
      dto.emailId ?? current.emailId,
      dto.dedupeKey ?? current.dedupeKey,
      dto.importedAt ? new Date(dto.importedAt) : current.importedAt,
      dto.referenceNo ?? current.referenceNo,
      dto.externalId ?? current.externalId,
    )
    return this.repository.update(entity)
  }

  remove(tenantId: string, id: string): Promise<void> {
    return this.repository.delete(tenantId, id)
  }
}
