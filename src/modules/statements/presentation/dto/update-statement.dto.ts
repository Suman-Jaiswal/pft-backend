import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator'

export class UpdateStatementDto {
  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  minimumAmountDue?: number

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalAmountDue?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  status?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  statementSyncMonth?: string
}
