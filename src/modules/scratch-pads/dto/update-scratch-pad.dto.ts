import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator'

export class UpdateScratchPadDto {
  @ApiPropertyOptional({ example: 'Scratch 1' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

  @ApiPropertyOptional({ description: 'Legacy workbook snapshot JSON' })
  @IsOptional()
  @IsObject()
  workbook?: Record<string, unknown>

  @ApiPropertyOptional({
    description: 'Google Spreadsheet id to embed. Pass null to unlink.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  googleSpreadsheetId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number
}
