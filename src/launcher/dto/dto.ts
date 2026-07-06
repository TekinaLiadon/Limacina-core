import { ApiProperty } from "@nestjs/swagger";

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
