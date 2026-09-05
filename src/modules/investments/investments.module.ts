import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { InvestmentsController } from '@/modules/investments/investments.controller'
import { InvestmentsService } from '@/modules/investments/investments.service'

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
