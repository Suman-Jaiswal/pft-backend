import { Module } from '@nestjs/common'
import { UsersService } from '@/modules/users/users.service'

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
