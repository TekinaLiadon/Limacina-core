import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { validationMessages } from "../../common/validation-messages";

export class InitOwnerDto {
  @ApiProperty({ example: "owner", description: "Юзернейм владельца" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  username!: string;

  @ApiProperty({ example: "securepassword", description: "Пароль владельца", minLength: 6 })
  @IsString({ message: validationMessages.string("password") })
  @MinLength(6, { message: validationMessages.minLength("password", 6) })
  password!: string;
}

export class InitOwnerResponseDto {
  @ApiProperty({ example: "a1b2c3d4e5f6" })
  uuid!: string;

  @ApiProperty({ example: "owner" })
  username!: string;
}

export class RestartServerDto {
  @ApiProperty({
    example: true,
    required: false,
    default: false,
    description: "Пересобрать бинарник (bun run build) перед перезапуском",
  })
  @IsOptional()
  @IsBoolean()
  rebuild?: boolean;
}
