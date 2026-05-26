import { ApiProperty } from '@nestjs/swagger'
import { IsNumber, Min } from 'class-validator'

export class DeductStashDto {
  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  amount!: number
}
