import { Injectable } from '@nestjs/common'
import { Prisma, Transaction } from '@prisma/client'
import {
  ITransactionRepository,
  TransactionQuery,
  TransactionListItem,
  TransactionListResult,
} from '@/modules/transactions/domain/repositories/transaction.repository'
import { TransactionEntity } from '@/modules/transactions/domain/entities/transaction.entity'
import { Money } from '@/modules/transactions/domain/value-objects/money.vo'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { AdjustmentType, roundMoney } from '@/modules/transactions/domain/effective-amount'

type TransactionWithAdjustment = Prisma.TransactionGetPayload<{
  include: { adjustment: true }
}>

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

function toListItem(row: TransactionWithAdjustment): TransactionListItem {
  const entity = toEntity(row)
  const adjustment = row.adjustment

  return {
    ...entity,
    amount: Number(row.amount),
    adjustment: adjustment
      ? {
          type: adjustment.type as AdjustmentType,
          personalShare: adjustment.personalShare == null ? null : Number(adjustment.personalShare),
          amortizeMonths: adjustment.amortizeMonths,
          monthlyAmount:
            adjustment.type === 'AMORTIZE' && adjustment.amortizeMonths
              ? roundMoney(Number(row.amount) / adjustment.amortizeMonths)
              : null,
          note: adjustment.note,
        }
      : null,
  }
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

  async list(query: TransactionQuery): Promise<TransactionListResult> {
    const where = this.buildWhere(query)
    if (query.limit != null || query.cursor) {
      return this.listWithCursor(query, where)
    }
    return this.listWithOffset(query, where)
  }

  private async listWithOffset(
    query: TransactionQuery,
    where: Prisma.TransactionWhereInput,
  ): Promise<TransactionListResult> {
    const skip = (query.page - 1) * query.pageSize
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
        include: { adjustment: true },
      }),
      this.prisma.transaction.count({ where }),
    ])
    return { items: rows.map(toListItem), total }
  }

  private async listWithCursor(
    query: TransactionQuery,
    baseWhere: Prisma.TransactionWhereInput,
  ): Promise<TransactionListResult> {
    const limit = query.limit ?? 20
    const cursor = this.decodeCursor(query.cursor)
    const where: Prisma.TransactionWhereInput = cursor
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { txnTimestamp: { lt: cursor.ts } },
                { txnTimestamp: cursor.ts, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : baseWhere

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ txnTimestamp: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: { adjustment: true },
      }),
      this.prisma.transaction.count({ where: baseWhere }),
    ])

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items[items.length - 1]

    return {
      items: items.map(toListItem),
      total,
      hasMore,
      nextCursor: hasMore && last
        ? this.encodeCursor(last.txnTimestamp ?? last.txnDate, last.id)
        : null,
    }
  }

  private buildWhere(query: TransactionQuery): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {
      tenantId: query.tenantId,
    }
    if (query.cardId) where.cardId = query.cardId
    if (query.fromDate || query.toDate) {
      where.txnDate = {
        ...(query.fromDate ? { gte: query.fromDate } : {}),
        ...(query.toDate ? { lte: query.toDate } : {}),
      }
    }
    const search = query.q?.trim()
    if (search) {
      where.merchant = { contains: search, mode: 'insensitive' }
    }
    return where
  }

  private encodeCursor(ts: Date, id: string): string {
    const payload = JSON.stringify({ ts: ts.toISOString(), id })
    return Buffer.from(payload, 'utf8').toString('base64url')
  }

  private decodeCursor(raw?: string): { ts: Date; id: string } | null {
    if (!raw) return null
    try {
      const text = Buffer.from(raw, 'base64url').toString('utf8')
      const parsed = JSON.parse(text) as { ts?: string; id?: string }
      if (!parsed?.ts || !parsed?.id) return null
      const ts = new Date(parsed.ts)
      if (Number.isNaN(ts.getTime())) return null
      return { ts, id: parsed.id }
    } catch {
      return null
    }
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
