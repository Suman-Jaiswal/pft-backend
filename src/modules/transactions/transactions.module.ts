import { Module } from '@nestjs/common'
import { TransactionsController } from '@/modules/transactions/transactions.controller'
import { TransactionsService } from '@/modules/transactions/transactions.service'
import { TRANSACTION_REPOSITORY } from '@/modules/transactions/domain/repositories/transaction.repository'
import { PrismaTransactionRepository } from '@/infrastructure/repositories/prisma-transaction.repository'
import { CardCycleSummaryService } from '@/modules/transactions/services/card-cycle-summary.service'

@Module({
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    CardCycleSummaryService,
    { provide: TRANSACTION_REPOSITORY, useClass: PrismaTransactionRepository },
  ],
  exports: [TRANSACTION_REPOSITORY],
})
export class TransactionsModule {}
