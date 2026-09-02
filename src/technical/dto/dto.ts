import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class InitOwnerDto {
  @ApiProperty({ example: "owner", description: "Юзернейм владельца" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "securepassword", description: "Пароль владельца", minLength: 6 })
  @IsString()
  @MinLength(6)
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
