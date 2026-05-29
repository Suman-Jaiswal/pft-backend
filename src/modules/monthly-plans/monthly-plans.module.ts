import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { MonthlyPlansController } from '@/modules/monthly-plans/monthly-plans.controller'
import { MonthlyPlansService } from '@/modules/monthly-plans/monthly-plans.service'
import { PrismaMonthlyPlanRepository } from '@/infrastructure/repositories/prisma-monthly-plan.repository'
import { MONTHLY_PLAN_REPOSITORY } from '@/modules/monthly-plans/domain/repositories/monthly-plan.repository'

@Module({
  imports: [PrismaModule],
  providers: [
    MonthlyPlansService,
    PrismaMonthlyPlanRepository,
    { provide: MONTHLY_PLAN_REPOSITORY, useExisting: PrismaMonthlyPlanRepository },
  ],
  controllers: [MonthlyPlansController],
})
export class MonthlyPlansModule {}
