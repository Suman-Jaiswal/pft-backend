import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { BillsService } from '@/modules/bills/bills.service'
import { BillsController } from '@/modules/bills/bills.controller'
import { PrismaBillRepository } from '@/infrastructure/repositories/prisma-bill.repository'
import { BILL_REPOSITORY } from '@/modules/bills/domain/repositories/bill.repository'

@Module({
  imports: [PrismaModule],
  providers: [
    BillsService,
    PrismaBillRepository,
    { provide: BILL_REPOSITORY, useExisting: PrismaBillRepository },
  ],
  controllers: [BillsController],
})
export class BillsModule {}
