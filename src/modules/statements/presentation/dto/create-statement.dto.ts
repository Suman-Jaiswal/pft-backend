import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator'

export class CreateStatementDto {
  @ApiProperty()
  @IsString()
  cardId!: string

  @ApiProperty()
  @IsString()
  cardKey!: string

  @ApiProperty({ example: '2026-05' })
  @Matches(/^\d{4}-\d{2}$/)
  statementMonth!: string

  @ApiProperty()
  @IsDateString()
  dueDate!: string

  @ApiProperty()
  @IsNumber()
  @Min(0)
  minimumAmountDue!: number

  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalAmountDue!: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  status?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  statementSyncMonth?: string
}
