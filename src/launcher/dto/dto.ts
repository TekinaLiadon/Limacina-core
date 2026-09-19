import { ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsString } from "class-validator";
import { validationMessages } from "../../common/validation-messages";

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

export class UpdaterPlatformReleaseDto {
  @ApiProperty({
    description: "URL артефакта релиза (раздаётся статикой из public/releases)",
    example: "http://localhost:3005/releases/1.2.3/Limacina-1.2.3-windows-x86_64.exe",
  })
  url!: string;

  @ApiProperty({
    description: "Minisign-подпись артефакта — содержимое .sig-файла рядом с артефактом",
    example: "untrusted comment: signature from ed25519 key\nRWQ...",
  })
  signature!: string;
}

export class UpdaterLatestDto {
  @ApiProperty({ description: "Версия релиза", example: "1.2.3" })
  version!: string;

  @ApiProperty({
    description: "Дата публикации релиза (RFC 3339, по времени артефактов на сервере)",
    example: "2026-09-15T18:00:00.000Z",
  })
  pub_date!: string;

  @ApiProperty({
    description:
      "Артефакты по платформам; ключи — цели tauri-plugin-updater (windows-x86_64, darwin-aarch64, ...)",
    type: "object",
    additionalProperties: { $ref: getSchemaPath(UpdaterPlatformReleaseDto) },
  })
  platforms!: Record<string, UpdaterPlatformReleaseDto>;
}

export class UpdaterReleaseInfoDto {
  @ApiProperty({ description: "Версия релиза", example: "1.2.3" })
  version!: string;

  @ApiProperty({
    description: "Дата публикации релиза (RFC 3339, по времени артефактов на сервере)",
    example: "2026-09-15T18:00:00.000Z",
  })
  pubDate!: string;

  @ApiProperty({
    type: [String],
    description: "Платформы с полной парой артефакт+подпись",
    example: ["windows-x86_64"],
  })
  platforms!: string[];
}

export class UpdaterReleasesListDto {
  @ApiProperty({
    type: [UpdaterReleaseInfoDto],
    description: "Релизы лаунчера (от новых к старым)",
  })
  releases!: UpdaterReleaseInfoDto[];
}

export class LauncherConfigDto {
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
