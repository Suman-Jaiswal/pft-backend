import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({
    example: "user@example.com",
    description: "User email address",
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "password123",
    description: "User password (minimum 8 characters)",
  })
  @IsString()
  @MinLength(8)
  password!: string;
}
