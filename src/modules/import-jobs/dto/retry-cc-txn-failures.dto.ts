import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class RetryCcTxnFailuresDto {
  @ApiPropertyOptional({ type: [String], description: 'Failure row ids to retry' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Retry failures for selected banks (OPEN/RETRYING)' })
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

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean
}
