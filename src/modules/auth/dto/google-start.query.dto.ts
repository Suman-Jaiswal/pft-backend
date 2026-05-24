import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class GoogleStartQueryDto {
  @ApiPropertyOptional({ description: 'Opaque client state value' })
  @IsOptional()
  @IsString()
  state?: string
}
