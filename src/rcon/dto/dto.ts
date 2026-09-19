import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { validationMessages } from "../../common/validation-messages";

export class RconStatusDto {
  @ApiProperty({
    example: true,
    description: "Доступен ли RCON: коннект к серверу и авторизация проходят (ответ кешируется)",
  })
  @IsBoolean({ message: validationMessages.boolean("enabled") })
  enabled!: boolean;
}

export class RconCommandsDto {
  @ApiProperty({
    example: ["say", "list", "stop"],
    description: "Дефолтный список ванильных команд для автокомплита в панели",
  })
  @IsArray({ message: validationMessages.array("commands") })
  @IsString({ each: true, message: validationMessages.arrayItemString("commands") })
  commands!: string[];
}

export class RconExecuteDto {
  @ApiProperty({
    example: "say Hello world",
    description: "Команда без ведущего слеша (бек толерантен — обрезает), до 256 символов",
  })
  @IsString({ message: validationMessages.string("command") })
  @IsNotEmpty({ message: validationMessages.notEmpty("command") })
  @MaxLength(256, { message: validationMessages.maxLength("command", 256) })
  command!: string;
}

export class RconOutputDto {
  @ApiProperty({
    example: "Сервер: Hello world",
    description:
      "Текстовый ответ сервера; ошибки Minecraft (неизвестная команда) тоже здесь, не в 5xx",
  })
  @IsString({ message: validationMessages.string("output") })
  output!: string;
}
