import { ApiProperty } from "@nestjs/swagger";

export class LauncherPlatformDto {
  @ApiProperty()
  os!: string;

  @ApiProperty()
  arch!: string;
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
