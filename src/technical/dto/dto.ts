import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class InitOwnerDto {
  @ApiProperty({ example: "owner", description: "Юзернейм владельца" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "securepassword", description: "Пароль владельца", minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}
