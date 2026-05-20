import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { LoansController } from '@/modules/loans/loans.controller'
import { LoansService } from '@/modules/loans/loans.service'

@Module({
  imports: [PrismaModule],
  providers: [LoansService],
  controllers: [LoansController],
})
export class LoansModule {}
