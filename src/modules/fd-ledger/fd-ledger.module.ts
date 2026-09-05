import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { FdLedgerService } from '@/modules/fd-ledger/fd-ledger.service'

@Global()
@Module({
  imports: [PrismaModule],
  providers: [FdLedgerService],
  exports: [FdLedgerService],
})
export class FdLedgerModule {}
