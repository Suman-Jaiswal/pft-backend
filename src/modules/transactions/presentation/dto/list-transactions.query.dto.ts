import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ description: '1-based page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number

  @ApiPropertyOptional({ description: 'Cursor page size', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @ApiPropertyOptional({ description: 'Opaque pagination cursor token' })
  @IsOptional()
  @IsString()
  cursor?: string

  @ApiPropertyOptional({ description: 'Filter by card id' })
  @IsOptional()
  @IsString()
  cardId?: string

  @ApiPropertyOptional({
    description: 'Filter from date (YYYY-MM-DD)',
    type: String,
    format: 'date',
    example: '2026-05-01',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string

  @ApiPropertyOptional({
    description: 'Filter to date (YYYY-MM-DD)',
    type: String,
    format: 'date',
    example: '2026-05-31',
  })
  @IsOptional()
  @IsDateString()
  toDate?: string

  @ApiPropertyOptional({ description: 'Case-insensitive merchant search text' })
  @IsOptional()
  @IsString()
  q?: string
}
