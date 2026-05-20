import { Injectable } from '@nestjs/common'
import { Transaction } from '@prisma/client'
import {
  ITransactionRepository,
  TransactionQuery,
} from '@/modules/transactions/domain/repositories/transaction.repository'
import { TransactionEntity } from '@/modules/transactions/domain/entities/transaction.entity'
import { Money } from '@/modules/transactions/domain/value-objects/money.vo'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

function toEntity(row: Transaction): TransactionEntity {
  return new TransactionEntity(
    row.id,
    row.tenantId,
    row.createdAt,
    row.updatedAt,
    row.createdBy,
    row.updatedBy,
    row.cardId,
    row.statementId,
    row.txnDate,
    row.txnTimestamp,
    Money.create(Number(row.amount)),
    row.merchant,
    row.channel,
    row.bankKey,
    row.emailId,
    row.dedupeKey,
    row.importedAt,
    row.referenceNo,
    row.externalId,
  )
}

@Injectable()
export class PrismaTransactionRepository implements ITransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(txn: TransactionEntity): Promise<TransactionEntity> {
    const row = await this.prisma.transaction.create({
      data: {
        id: txn.id,
        tenantId: txn.tenantId,
        cardId: txn.cardId,
        statementId: txn.statementId ?? undefined,
        txnDate: txn.txnDate,
        txnTimestamp: txn.txnTimestamp ?? undefined,
        amount: txn.amount.value,
        merchant: txn.merchant,
        channel: txn.channel,
        bankKey: txn.bankKey ?? undefined,
        emailId: txn.emailId ?? undefined,
        dedupeKey: txn.dedupeKey ?? undefined,
        importedAt: txn.importedAt ?? undefined,
        referenceNo: txn.referenceNo ?? undefined,
        externalId: txn.externalId ?? undefined,
        createdBy: txn.createdBy,
        updatedBy: txn.updatedBy,
      },
    })
    return toEntity(row)
  }

  async findById(tenantId: string, id: string): Promise<TransactionEntity | null> {
    const row = await this.prisma.transaction.findFirst({ where: { tenantId, id } })
    return row ? toEntity(row) : null
  }

  async list(query: TransactionQuery): Promise<{ items: TransactionEntity[]; total: number }> {
    const where = {
      tenantId: query.tenantId,
      cardId: query.cardId,
      txnDate: {
        gte: query.fromDate,
        lte: query.toDate,
      },
    }
    const skip = (query.page - 1) * query.pageSize
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: { txnDate: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ])
    return { items: rows.map(toEntity), total }
  }

  async update(txn: TransactionEntity): Promise<TransactionEntity> {
    const row = await this.prisma.transaction.update({
      where: { id: txn.id },
      data: {
        txnDate: txn.txnDate,
        txnTimestamp: txn.txnTimestamp ?? undefined,
        amount: txn.amount.value,
        merchant: txn.merchant,
        channel: txn.channel,
        bankKey: txn.bankKey ?? undefined,
        emailId: txn.emailId ?? undefined,
        dedupeKey: txn.dedupeKey ?? undefined,
        importedAt: txn.importedAt ?? undefined,
        referenceNo: txn.referenceNo ?? undefined,
        externalId: txn.externalId ?? undefined,
        statementId: txn.statementId ?? undefined,
        updatedBy: txn.updatedBy,
      },
    })
    return toEntity(row)
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.prisma.transaction.deleteMany({ where: { tenantId, id } })
  }
}
