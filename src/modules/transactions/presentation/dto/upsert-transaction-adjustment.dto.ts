import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator'

export class UpsertTransactionAdjustmentDto {
  @ApiProperty({ enum: ['SPLIT', 'EXCLUDE', 'AMORTIZE'] })
  @IsIn(['SPLIT', 'EXCLUDE', 'AMORTIZE'])
  type!: 'SPLIT' | 'EXCLUDE' | 'AMORTIZE'

  @ApiPropertyOptional()
  @ValidateIf((o) => o.type === 'SPLIT')
  @IsNumber()
  personalShare?: number

  @ApiPropertyOptional()
  @ValidateIf((o) => o.type === 'AMORTIZE')
  @IsInt()
  @Min(2)
  @Max(60)
  amortizeMonths?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
