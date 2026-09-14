import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class IgnoreCcTxnFailuresDto {
  @ApiPropertyOptional({ type: [String], description: 'Failure row ids to permanently ignore' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Ignore OPEN/RETRYING failures for selected banks' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bankKeys?: string[]

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number
}
