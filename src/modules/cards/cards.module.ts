import { Module } from '@nestjs/common'
import { CardsController } from '@/modules/cards/cards.controller'
import { CardsService } from '@/modules/cards/cards.service'
import { CARD_REPOSITORY } from '@/modules/cards/domain/repositories/card.repository'
import { PrismaCardRepository } from '@/infrastructure/repositories/prisma-card.repository'
import { CreateCardUseCase } from '@/modules/cards/application/use-cases/create-card.use-case'

@Module({
  controllers: [CardsController],
  providers: [
    CardsService,
    CreateCardUseCase,
    { provide: CARD_REPOSITORY, useClass: PrismaCardRepository },
  ],
  exports: [CARD_REPOSITORY],
})
export class CardsModule {}
