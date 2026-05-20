import { StatementEntity } from '@/modules/statements/domain/entities/statement.entity'

export interface StatementQuery {
  tenantId: string
  cardId?: string
  statementMonth?: string
  page: number
  pageSize: number
}

export interface IStatementRepository {
  create(statement: StatementEntity): Promise<StatementEntity>
  findById(tenantId: string, id: string): Promise<StatementEntity | null>
  findByCardAndMonth(tenantId: string, cardId: string, statementMonth: string): Promise<StatementEntity | null>
  list(query: StatementQuery): Promise<{ items: StatementEntity[]; total: number }>
  update(statement: StatementEntity): Promise<StatementEntity>
}

export const STATEMENT_REPOSITORY = Symbol('STATEMENT_REPOSITORY')
