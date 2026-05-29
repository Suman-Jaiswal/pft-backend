import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { LoansController } from '@/modules/loans/loans.controller'
import { LoansService } from '@/modules/loans/loans.service'
import { PrismaLoanRepository } from '@/infrastructure/repositories/prisma-loan.repository'
import { LOAN_REPOSITORY } from '@/modules/loans/domain/repositories/loan.repository'

@Module({
  imports: [PrismaModule],
  providers: [
    LoansService,
    PrismaLoanRepository,
    { provide: LOAN_REPOSITORY, useExisting: PrismaLoanRepository },
  ],
  controllers: [LoansController],
})
export class LoansModule {}
