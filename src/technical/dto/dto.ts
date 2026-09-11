import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { validationMessages } from "../../common/validation-messages";
export class InitOwnerDto {
  @ApiProperty({ example: "owner", description: "Юзернейм владельца" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  username!: string;

  @ApiProperty({
    example: "securepassword",
    description: "Пароль владельца",
    minLength: 6,
    maxLength: 128,
  })
  @IsString({ message: validationMessages.string("password") })
  @MinLength(6, { message: validationMessages.minLength("password", 6) })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
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
    description:
      "Запустить конвейер пересборки (git pull → bun install → миграции → bun run build) в фоне перед перезапуском",
  })
  @IsOptional()
  @IsBoolean({ message: validationMessages.boolean("rebuild") })
  rebuild?: boolean;
}

export class RebuildStatusDto {
  @ApiProperty({ example: true, description: "Выполняется ли конвейер пересборки" })
  inProgress!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    example: "Пересборка не удалась на шаге bun install, перезапуск отменён",
    description: "Ошибка последнего запуска (null — последний запуск успешен или запусков не было)",
  })
  lastError!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "Ревизия git до pull последнего запуска (null — pull не выполнялся)",
  })
  revisionBefore!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "Ревизия git после pull последнего запуска (null — pull не выполнялся)",
  })
  revisionAfter!: string | null;
}
