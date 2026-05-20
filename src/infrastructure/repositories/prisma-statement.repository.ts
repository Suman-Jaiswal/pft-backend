import { Injectable } from '@nestjs/common'
import { Statement } from '@prisma/client'
import {
  IStatementRepository,
  StatementQuery,
} from '@/modules/statements/domain/repositories/statement.repository'
import {
  StatementEntity,
  StatementStatus,
} from '@/modules/statements/domain/entities/statement.entity'
import { StatementMonth } from '@/modules/statements/domain/value-objects/statement-month.vo'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

function toEntity(row: Statement): StatementEntity {
  return new StatementEntity(
    row.id,
    row.tenantId,
    row.createdAt,
    row.updatedAt,
    row.createdBy,
    row.updatedBy,
    row.cardId,
    row.cardKey,
    StatementMonth.create(row.statementMonth),
    row.dueDate,
    Number(row.minimumAmountDue),
    Number(row.totalAmountDue),
    row.status as StatementStatus,
    row.statementSyncMonth,
  )
}

@Injectable()
export class PrismaStatementRepository implements IStatementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(statement: StatementEntity): Promise<StatementEntity> {
    const row = await this.prisma.statement.create({
      data: {
        id: statement.id,
        tenantId: statement.tenantId,
        cardId: statement.cardId,
        cardKey: statement.cardKey,
        statementMonth: statement.statementMonth.value,
        dueDate: statement.dueDate,
        minimumAmountDue: statement.minimumAmountDue,
        totalAmountDue: statement.totalAmountDue,
        status: statement.status,
        statementSyncMonth: statement.statementSyncMonth ?? undefined,
        createdBy: statement.createdBy,
        updatedBy: statement.updatedBy,
      },
    })
    return toEntity(row)
  }

  async findById(tenantId: string, id: string): Promise<StatementEntity | null> {
    const row = await this.prisma.statement.findFirst({ where: { tenantId, id } })
    return row ? toEntity(row) : null
  }

  async findByCardAndMonth(
    tenantId: string,
    cardId: string,
    statementMonth: string,
  ): Promise<StatementEntity | null> {
    const row = await this.prisma.statement.findFirst({ where: { tenantId, cardId, statementMonth } })
    return row ? toEntity(row) : null
  }

  async list(query: StatementQuery): Promise<{ items: StatementEntity[]; total: number }> {
    const where = {
      tenantId: query.tenantId,
      cardId: query.cardId,
      statementMonth: query.statementMonth,
    }
    const skip = (query.page - 1) * query.pageSize
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.statement.findMany({
        where,
        orderBy: { statementMonth: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.statement.count({ where }),
    ])
    return { items: rows.map(toEntity), total }
  }

  async update(statement: StatementEntity): Promise<StatementEntity> {
    const row = await this.prisma.statement.update({
      where: { id: statement.id },
      data: {
        dueDate: statement.dueDate,
        minimumAmountDue: statement.minimumAmountDue,
        totalAmountDue: statement.totalAmountDue,
        status: statement.status,
        statementSyncMonth: statement.statementSyncMonth ?? undefined,
        updatedBy: statement.updatedBy,
      },
    })
    return toEntity(row)
  }
}
