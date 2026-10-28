import { Module } from '@nestjs/common'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { ScratchPadsController } from '@/modules/scratch-pads/scratch-pads.controller'
import { ScratchPadsService } from '@/modules/scratch-pads/scratch-pads.service'

@Module({
  imports: [PrismaModule],
  controllers: [ScratchPadsController],
  providers: [ScratchPadsService],
})
export class ScratchPadsModule {}
