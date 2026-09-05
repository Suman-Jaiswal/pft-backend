import { Module } from '@nestjs/common'
import { PrismaGoalRepository } from '@/infrastructure/repositories/prisma-goal.repository'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { GOAL_REPOSITORY } from '@/modules/goals/domain/repositories/goal.repository'
import { GoalsController } from '@/modules/goals/goals.controller'
import { GoalsService } from '@/modules/goals/goals.service'

@Module({
  imports: [PrismaModule],
  providers: [
    GoalsService,
    PrismaGoalRepository,
    { provide: GOAL_REPOSITORY, useExisting: PrismaGoalRepository },
  ],
  controllers: [GoalsController],
})
export class GoalsModule {}
