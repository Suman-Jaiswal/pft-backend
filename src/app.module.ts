import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@/modules/health/health.module'
import { CardsModule } from '@/modules/cards/cards.module'
import { StatementsModule } from '@/modules/statements/statements.module'
import { TransactionsModule } from '@/modules/transactions/transactions.module'
import { AuthModule } from '@/modules/auth/auth.module'
import { UsersModule } from '@/modules/users/users.module'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { RolesGuard } from '@/shared/auth/roles.guard'
import { SettingsModule } from '@/modules/settings/settings.module'
import { MonthlyPlansModule } from '@/modules/monthly-plans/monthly-plans.module'
import { BillsModule } from '@/modules/bills/bills.module'
import { LoansModule } from '@/modules/loans/loans.module'
import { ImportJobsModule } from '@/modules/import-jobs/import-jobs.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    MonthlyPlansModule,
    BillsModule,
    LoansModule,
    CardsModule,
    StatementsModule,
    TransactionsModule,
    ImportJobsModule,
    HealthModule,
  ],
  providers: [RolesGuard],
})
export class AppModule {}
