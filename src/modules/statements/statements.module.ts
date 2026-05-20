import { Module } from '@nestjs/common'
import { StatementsController } from '@/modules/statements/statements.controller'
import { StatementsService } from '@/modules/statements/statements.service'
import { STATEMENT_REPOSITORY } from '@/modules/statements/domain/repositories/statement.repository'
import { PrismaStatementRepository } from '@/infrastructure/repositories/prisma-statement.repository'

@Module({
  controllers: [StatementsController],
  providers: [
    StatementsService,
    { provide: STATEMENT_REPOSITORY, useClass: PrismaStatementRepository },
  ],
  exports: [STATEMENT_REPOSITORY],
})
export class StatementsModule {}
