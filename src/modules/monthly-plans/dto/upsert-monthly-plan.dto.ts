import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'

export class UpsertMonthlyPlanDto {
  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(12)
  month!: number

  @ApiProperty()
  @IsNumber()
  year!: number

  @ApiPropertyOptional() @IsOptional() @IsNumber() rent?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() cook?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() sip?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() bills?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() basicCcSpent?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() investment?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() liquidSaved?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() otherExpenses?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() salary?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() otherIncome?: number
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() loanPayments?: unknown[]
  @ApiPropertyOptional() @IsOptional() @IsArray() customExpenses?: unknown[]
  @ApiPropertyOptional() @IsOptional() @IsObject() banks?: Record<string, unknown>
}
