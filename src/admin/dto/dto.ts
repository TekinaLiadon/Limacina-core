import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { Transform, Type } from "class-transformer";

export const AVAILABLE_ROLES = ["admin", "moderator", "user"] as const;
export type AvailableRole = (typeof AVAILABLE_ROLES)[number];

export interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

export class UnapprovedUsersQueryDto {
  @ApiProperty({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AllUsersQueryDto {
  @ApiProperty({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UsersQueryDto {
  @ApiProperty({
    default: 10,
    minimum: 1,
    maximum: 100,
    description: "Пользователей на страницу",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ default: 0, minimum: 0, description: "Смещение от начала списка" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    example: "john",
    required: false,
    description: "Поиск по началу юзернейма (без учёта регистра)",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  @ApiProperty({
    example: false,
    required: false,
    description: "Фильтр по статусу одобрения (false — только неодобренные)",
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  approved?: boolean;
}

export class ApproveUserDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  approved!: boolean;
}

export class BanUserDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  banned!: boolean;
}

export class SetRoleDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "user", enum: AVAILABLE_ROLES })
  @IsString()
  @IsIn(AVAILABLE_ROLES)
  role!: AvailableRole;
}

export class SetUserPasswordDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "newsecret123", minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

export class SetOwnerDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;
}

export class UserListItemDto {
  @ApiProperty({ example: "a1b2c3d4e5f6" })
  uuid!: string;

  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "user" })
  role!: string;

  @ApiProperty({ example: true })
  approved!: boolean;

  @ApiProperty({ example: false })
  banned!: boolean;
}

export class UsersListResponseDto {
  @ApiProperty({ example: 0, description: "Смещение от начала списка" })
  offset!: number;

  @ApiProperty({ example: 10, description: "Пользователей на страницу" })
  limit!: number;

  @ApiProperty({ example: 42, description: "Всего пользователей по фильтру" })
  total!: number;

  @ApiProperty({ type: [UserListItemDto] })
  items!: UserListItemDto[];
}

export class DeletedUserListItemDto {
  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "user" })
  role!: string;

  @ApiProperty({ example: true })
  approved!: boolean;

  @ApiProperty({ example: false })
  banned!: boolean;

  @ApiProperty({ example: "2026-07-10T12:00:00.000Z" })
  deletedAt!: Date;
}

export class DeletedUsersListResponseDto {
  @ApiProperty({ example: 0, description: "Смещение от начала списка" })
  offset!: number;

  @ApiProperty({ example: 10, description: "Пользователей на страницу" })
  limit!: number;

  @ApiProperty({ example: 42, description: "Всего удалённых пользователей по фильтру" })
  total!: number;

  @ApiProperty({ type: [DeletedUserListItemDto] })
  items!: DeletedUserListItemDto[];
}

export class DeletedUsersQueryDto {
  @ApiProperty({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class V1DeletedUsersQueryDto extends DeletedUsersQueryDto {
  @ApiProperty({ default: 0, minimum: 0, description: "Смещение от начала списка" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    example: "john",
    required: false,
    description: "Поиск по началу юзернейма (без учёта регистра)",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;
}

export class LogsQueryDto {
  @ApiProperty({
    example: "2026-07-08",
    description: "Дата логов в формате YYYY-MM-DD. По умолчанию — сегодня",
    required: false,
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ default: 0, minimum: 0, description: "Смещение от начала файла (номер строки)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({
    default: 100,
    minimum: 1,
    maximum: 1000,
    description: "Максимум строк на страницу",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class V1LogsQueryDto extends LogsQueryDto {
  @ApiProperty({
    example: 200,
    required: false,
    description: "Фильтр по статус-коду ответа (точное совпадение)",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @ApiProperty({
    example: "/v1/common/auth",
    required: false,
    description: "Фильтр по URL запроса (подстрока, без учёта регистра)",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;

  @ApiProperty({
    example: "127.0.0.1",
    required: false,
    description: "Фильтр по IP клиента (подстрока, без учёта регистра)",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ip?: string;
}

export class LogsResponseDto {
  @ApiProperty({ example: "2026-07-08" })
  date!: string;

  @ApiProperty({ example: 0 })
  offset!: number;

  @ApiProperty({ example: 100 })
  limit!: number;

  @ApiProperty({ example: 5432 })
  total!: number;

  @ApiProperty({
    type: [String],
    example: [
      '{"level":30,"time":1751971200000,"req":{"id":"req-1","method":"GET","url":"/v1/common/auth/login","remoteAddress":"127.0.0.1"},"res":{"statusCode":200},"msg":"request completed","responseTime":12}',
      '{"level":30,"time":1751971201000,"req":{"id":"req-2","method":"POST","url":"/v1/common/auth/registration","remoteAddress":"192.168.1.10"},"res":{"statusCode":400},"msg":"request completed","responseTime":5}',
    ],
  })
  lines!: string[];
}

export class LauncherConfigUpdateDto {
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

export class LauncherUpdateResponseDto {
  @ApiProperty({ example: "1.2.3" })
  version!: string;

  @ApiProperty({ type: [String], example: ["linux/x86_64", "macos/arm64", "windows/x86_64"] })
  updated!: string[];
}
