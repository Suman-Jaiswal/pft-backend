import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { ImportFailureStatus, ImportFailureType } from '@/modules/import-jobs/types/import-contracts'

const STATUS_VALUES: ImportFailureStatus[] = ['OPEN', 'RETRYING', 'RESOLVED', 'IGNORED']
const FAILURE_TYPE_VALUES: ImportFailureType[] = [
  'PARSE_MISS',
  'PARSE_ERROR',
  'CARD_RULE_MISMATCH',
  'WRITE_FAILED',
  'CARD_NOT_FOUND',
]

export class ListCcTxnFailuresDto {
  @ApiPropertyOptional({ enum: STATUS_VALUES })
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: ImportFailureStatus

  @ApiPropertyOptional({ enum: FAILURE_TYPE_VALUES })
  @IsOptional()
  @IsIn(FAILURE_TYPE_VALUES)
  failureType?: ImportFailureType

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bankKeys?: string[]

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number
}
