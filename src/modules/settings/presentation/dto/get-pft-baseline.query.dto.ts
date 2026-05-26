import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'

export class GetPftBaselineQueryDto {
  @ApiProperty()
  @IsString()
  periodKey!: string

  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  version?: number
}
