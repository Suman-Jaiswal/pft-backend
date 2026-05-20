import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator'

export class CreateTransactionDto {
  @ApiProperty()
  @IsString()
  cardId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statementId?: string

  @ApiProperty()
  @IsDateString()
  txnDate!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  txnTimestamp?: string

  @ApiProperty()
  @IsNumber()
  amount!: number

  @ApiProperty()
  @IsString()
  merchant!: string

  @ApiProperty()
  @IsString()
  channel!: string

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
}
