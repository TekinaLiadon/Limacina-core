import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsString } from "class-validator";
import { validationMessages } from "../../common/validation-messages";

export class LauncherPlatformDto {
  @ApiProperty()
  os!: string;

  @ApiProperty()
  arch!: string;
}

export class LauncherVersionDto {
  @ApiProperty()
  version!: string;

  @ApiProperty({ type: [LauncherPlatformDto] })
  platforms!: LauncherPlatformDto[];
}

export class LauncherVersionInfoDto {
  @ApiProperty({ description: "Версия лаунчера", example: "1.2.3" })
  version!: string;

  @ApiProperty({ type: [LauncherPlatformDto], description: "Платформы, доступные для версии" })
  platforms!: LauncherPlatformDto[];
}

export class LauncherVersionsDto {
  @ApiProperty({ description: "Последняя (актуальная) версия лаунчера" })
  version!: string;

  @ApiProperty({
    type: [LauncherPlatformDto],
    description: "Платформы, доступные для последней версии",
  })
  platforms!: LauncherPlatformDto[];

  @ApiProperty({
    type: [LauncherVersionInfoDto],
    description: "Все доступные версии (от новых к старым), включая последнюю",
  })
  versions!: LauncherVersionInfoDto[];
}

export class LauncherConfigDto {
  @ApiProperty({ description: "Название проекта" })
  projectName!: string;

  @ApiProperty({ description: "Версия Minecraft" })
  mcVersion!: string;

  @ApiProperty({ description: "Тип загрузчика модов" })
  modLoader!: string;

  @ApiProperty({ description: "Версия загрузчика" })
  loaderVersion!: string;

  @ApiProperty({ description: "Аргументы JVM", type: [String] })
  jvmArgs!: string[];

  @ApiProperty({ description: "Минимальный объём памяти" })
  minMemory!: string;

  @ApiProperty({ description: "Максимальный объём памяти" })
  maxMemory!: string;

  @ApiProperty({ description: "Онлайн-режим" })
  online!: boolean;
}

export class LauncherConfigCreateDto {
  @ApiProperty({ description: "Название проекта", example: "Cordelia" })
  @IsString({ message: validationMessages.string("projectName") })
  projectName!: string;

  @ApiProperty({ description: "Версия Minecraft", example: "1.21.1" })
  @IsString({ message: validationMessages.string("mcVersion") })
  mcVersion!: string;

  @ApiProperty({ description: "Тип загрузчика модов", example: "neoforge" })
  @IsString({ message: validationMessages.string("modLoader") })
  modLoader!: string;

  @ApiProperty({ description: "Версия загрузчика", example: "21.1.234" })
  @IsString({ message: validationMessages.string("loaderVersion") })
  loaderVersion!: string;

  @ApiProperty({ description: "Аргументы JVM", type: [String], example: [] })
  @IsArray({ message: validationMessages.array("jvmArgs") })
  @IsString({ each: true, message: validationMessages.arrayItemString("jvmArgs") })
  jvmArgs!: string[];

  @ApiProperty({ description: "Минимальный объём памяти", example: "-Xms512M" })
  @IsString({ message: validationMessages.string("minMemory") })
  minMemory!: string;

  @ApiProperty({ description: "Максимальный объём памяти", example: "-Xmx2560M" })
  @IsString({ message: validationMessages.string("maxMemory") })
  maxMemory!: string;

  @ApiProperty({ description: "Онлайн-режим", example: true })
  @IsBoolean({ message: validationMessages.boolean("online") })
  online!: boolean;
}
