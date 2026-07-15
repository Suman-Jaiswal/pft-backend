import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class ListPftBaselinesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodKey?: string
}
