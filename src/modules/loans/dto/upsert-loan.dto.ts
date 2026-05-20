import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator'

export class UpsertLoanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string

  @ApiProperty()
  @IsString()
  name!: string

  @ApiProperty()
  @IsNumber()
  principal!: number

  @ApiProperty()
  @IsNumber()
  emi!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  rate?: number

  @ApiProperty()
  @IsDateString()
  startDate!: string

  @ApiProperty()
  @IsNumber()
  tenureMonths!: number

  @ApiPropertyOptional({ default: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: string
}
