import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { MonthlyPlansController } from '@/modules/monthly-plans/monthly-plans.controller'
import { MonthlyPlansService } from '@/modules/monthly-plans/monthly-plans.service'

@Module({
  imports: [PrismaModule],
  providers: [MonthlyPlansService],
  controllers: [MonthlyPlansController],
})
export class MonthlyPlansModule {}
