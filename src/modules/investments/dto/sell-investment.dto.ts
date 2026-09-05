import { ApiProperty } from '@nestjs/swagger'
import { IsNumber, IsPositive } from 'class-validator'

export class SellInvestmentDto {
  @ApiProperty({ minimum: 0, exclusiveMinimum: true })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  amount!: number
}
