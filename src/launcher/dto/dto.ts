import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsString } from "class-validator";

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
  @IsString()
  projectName!: string;

  @ApiProperty({ description: "Версия Minecraft", example: "1.21.1" })
  @IsString()
  mcVersion!: string;

  @ApiProperty({ description: "Тип загрузчика модов", example: "neoforge" })
  @IsString()
  modLoader!: string;

  @ApiProperty({ description: "Версия загрузчика", example: "21.1.234" })
  @IsString()
  loaderVersion!: string;

  @ApiProperty({ description: "Аргументы JVM", type: [String], example: [] })
  @IsArray()
  @IsString({ each: true })
  jvmArgs!: string[];

  @ApiProperty({ description: "Минимальный объём памяти", example: "-Xms512M" })
  @IsString()
  minMemory!: string;

  @ApiProperty({ description: "Максимальный объём памяти", example: "-Xmx2560M" })
  @IsString()
  maxMemory!: string;

  @ApiProperty({ description: "Онлайн-режим", example: true })
  @IsBoolean()
  online!: boolean;
}
