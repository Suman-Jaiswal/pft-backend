import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsNumber, IsOptional, IsString } from 'class-validator'

export class UpdatePftSettingsDto {
  @ApiPropertyOptional({ default: 'INR' })
  @IsString()
  @IsOptional()
  currency?: string

  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultSalary?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultOtherSources?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultRent?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultCook?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultLoanRepayment?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultSipMf?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultStocks?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultFd?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultSavings?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultStash?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultBills?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultBasicExpenses?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() defaultOtherExpenses?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() prevLiquidBalance?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() prevInvestmentBalance?: number
  @ApiPropertyOptional() @IsNumber() @IsOptional() stashDeductions?: number
  @ApiPropertyOptional() @IsString() @IsOptional() dashboardYearRange?: string
  @ApiPropertyOptional() @IsNumber() @IsOptional() dashboardBaselineVersion?: number
}
