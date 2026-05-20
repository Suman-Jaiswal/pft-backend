import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import {
  IStatementRepository,
  STATEMENT_REPOSITORY,
} from '@/modules/statements/domain/repositories/statement.repository'
import {
  StatementEntity,
  StatementStatus,
} from '@/modules/statements/domain/entities/statement.entity'
import { StatementMonth } from '@/modules/statements/domain/value-objects/statement-month.vo'
import { CreateStatementDto } from '@/modules/statements/presentation/dto/create-statement.dto'
import { UpdateStatementDto } from '@/modules/statements/presentation/dto/update-statement.dto'

@Injectable()
export class StatementsService {
  constructor(@Inject(STATEMENT_REPOSITORY) private readonly repository: IStatementRepository) {}

  create(tenantId: string, actorId: string, dto: CreateStatementDto): Promise<StatementEntity> {
    const now = new Date()
    const entity = new StatementEntity(
      `st_${randomUUID()}`,
      tenantId,
      now,
      now,
      actorId,
      actorId,
      dto.cardId,
      dto.cardKey,
      StatementMonth.create(dto.statementMonth),
      new Date(dto.dueDate),
      dto.minimumAmountDue,
      dto.totalAmountDue,
      (dto.status as StatementStatus | undefined) ?? StatementStatus.DUE,
      dto.statementSyncMonth ?? null,
    )
    return this.repository.create(entity)
  }

  async get(tenantId: string, id: string): Promise<StatementEntity> {
    const row = await this.repository.findById(tenantId, id)
    if (!row) throw new NotFoundException('Statement not found')
    return row
  }

  list(tenantId: string, page = 1, pageSize = 20, cardId?: string, statementMonth?: string) {
    return this.repository.list({ tenantId, page, pageSize, cardId, statementMonth })
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateStatementDto): Promise<StatementEntity> {
    const current = await this.get(tenantId, id)
    const entity = new StatementEntity(
      current.id,
      current.tenantId,
      current.createdAt,
      new Date(),
      current.createdBy,
      actorId,
      current.cardId,
      current.cardKey,
      current.statementMonth,
      dto.dueDate ? new Date(dto.dueDate) : current.dueDate,
      dto.minimumAmountDue ?? current.minimumAmountDue,
      dto.totalAmountDue ?? current.totalAmountDue,
      (dto.status as StatementStatus | undefined) ?? current.status,
      dto.statementSyncMonth ?? current.statementSyncMonth,
    )
    return this.repository.update(entity)
  }

  async markPaid(tenantId: string, actorId: string, id: string): Promise<StatementEntity> {
    return this.update(tenantId, actorId, id, { status: StatementStatus.PAID })
  }
}
