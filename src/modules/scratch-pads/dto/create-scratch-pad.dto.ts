import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator'

export class CreateScratchPadDto {
  @ApiProperty({ example: 'Scratch 1' })
  @IsString()
  @MinLength(1)
  name!: string

  @ApiPropertyOptional({ description: 'Legacy workbook snapshot JSON (unused for Google embeds)' })
  @IsOptional()
  @IsObject()
  workbook?: Record<string, unknown>

  @ApiPropertyOptional({
    description: 'Google Spreadsheet id to embed (from sheet URL). Null/omit = unlinked.',
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
