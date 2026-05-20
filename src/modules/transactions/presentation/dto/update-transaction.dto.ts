import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator'

export class UpdateTransactionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  txnDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  txnTimestamp?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchant?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNo?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dedupeKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  importedAt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statementId?: string
}
