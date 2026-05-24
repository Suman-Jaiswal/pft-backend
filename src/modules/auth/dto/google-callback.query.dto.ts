import { ApiProperty } from '@nestjs/swagger'
import { IsString } from 'class-validator'

export class GoogleCallbackQueryDto {
  @ApiProperty({ description: 'Google OAuth authorization code' })
  @IsString()
  code!: string
}
