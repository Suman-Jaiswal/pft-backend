import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { BillsService } from '@/modules/bills/bills.service'
import { BillsController } from '@/modules/bills/bills.controller'

@Module({
  imports: [PrismaModule],
  providers: [BillsService],
  controllers: [BillsController],
})
export class BillsModule {}
