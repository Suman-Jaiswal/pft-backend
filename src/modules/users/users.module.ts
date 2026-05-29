import { Module } from '@nestjs/common'
import { UsersService } from '@/modules/users/users.service'
import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { PrismaUserRepository } from '@/infrastructure/repositories/prisma-user.repository'
import { USER_REPOSITORY } from '@/modules/users/domain/repositories/user.repository'

@Module({
  imports: [PrismaModule],
  providers: [
    UsersService,
    PrismaUserRepository,
    { provide: USER_REPOSITORY, useExisting: PrismaUserRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
