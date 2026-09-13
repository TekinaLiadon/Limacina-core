import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { validationMessages } from "../../common/validation-messages";
import { ASSIGNABLE_ROLES, type AssignableRole } from "../../common/roles";

export const LOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

export class UsersSearchQueryDto {
  @ApiProperty({
    default: 10,
    minimum: 1,
    maximum: 100,
    description: "Пользователей на страницу",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("limit") })
  @Min(1, { message: validationMessages.min("limit", 1) })
  @Max(100, { message: validationMessages.max("limit", 100) })
  limit?: number;

  @ApiProperty({ default: 0, minimum: 0, description: "Смещение от начала списка" })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("offset") })
  @Min(0, { message: validationMessages.min("offset", 0) })
  offset?: number;

  @ApiProperty({
    example: "john",
    required: false,
    description: "Поиск по началу юзернейма (без учёта регистра)",
  })
  @IsOptional()
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  username?: string;
}

export class UsersQueryDto extends UsersSearchQueryDto {
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
  @IsBoolean({ message: validationMessages.boolean("approved") })
  approved?: boolean;
}

export class ApproveUserDto {
  @ApiProperty({ example: "john" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
  username!: string;

  @ApiProperty({ example: true })
  @IsBoolean({ message: validationMessages.boolean("approved") })
  approved!: boolean;
}

export class BanUserDto {
  @ApiProperty({ example: "john" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
  username!: string;

  @ApiProperty({ example: true })
  @IsBoolean({ message: validationMessages.boolean("banned") })
  banned!: boolean;
}

export class SetRoleDto {
  @ApiProperty({ example: "john" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
  username!: string;

  @ApiProperty({ example: "user", enum: ASSIGNABLE_ROLES })
  @IsString({ message: validationMessages.string("role") })
  @IsIn(ASSIGNABLE_ROLES, {
    message: validationMessages.enum("role", ASSIGNABLE_ROLES.join(", ")),
  })
  role!: AssignableRole;
}

export class SetUserPasswordDto {
  @ApiProperty({ example: "john" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
  username!: string;

  @ApiProperty({ example: "newsecret123", minLength: 6, maxLength: 128 })
  @IsString({ message: validationMessages.string("password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("password") })
  @MinLength(6, { message: validationMessages.minLength("password", 6) })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
  password!: string;
}

export class SetOwnerDto {
  @ApiProperty({ example: "john" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
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

export class V1DeletedUsersQueryDto extends UsersSearchQueryDto {}

export class V1LogsQueryDto {
  @ApiProperty({
    example: "2026-07-08",
    description: "Дата логов в формате YYYY-MM-DD. По умолчанию — сегодня",
    required: false,
  })
  @IsOptional()
  @Matches(LOG_DATE_PATTERN, { message: validationMessages.dateYmd("date") })
  date?: string;

  @ApiProperty({
    default: 0,
    minimum: 0,
    description: "Смещение от начала списка отфильтрованных строк",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("offset") })
  @Min(0, { message: validationMessages.min("offset", 0) })
  offset?: number;

  @ApiProperty({
    default: 100,
    minimum: 1,
    maximum: 1000,
    description: "Максимум строк на страницу",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("limit") })
  @Min(1, { message: validationMessages.min("limit", 1) })
  @Max(1000, { message: validationMessages.max("limit", 1000) })
  limit?: number;

  @ApiProperty({
    example: 200,
    required: false,
    description: "Фильтр по статус-коду ответа (точное совпадение)",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("statusCode") })
  @Min(100, { message: validationMessages.min("statusCode", 100) })
  @Max(599, { message: validationMessages.max("statusCode", 599) })
  statusCode?: number;

  @ApiProperty({
    example: "/v1/common/auth",
    required: false,
    description: "Фильтр по URL запроса (подстрока, без учёта регистра)",
  })
  @IsOptional()
  @IsString({ message: validationMessages.string("url") })
  @IsNotEmpty({ message: validationMessages.notEmpty("url") })
  url?: string;

  @ApiProperty({
    example: "127.0.0.1",
    required: false,
    description: "Фильтр по IP клиента (подстрока, без учёта регистра)",
  })
  @IsOptional()
  @IsString({ message: validationMessages.string("ip") })
  @IsNotEmpty({ message: validationMessages.notEmpty("ip") })
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

export class LauncherUpdateResponseDto {
  @ApiProperty({ example: "1.2.3" })
  version!: string;

  @ApiProperty({ type: [String], example: ["linux/x86_64", "macos/arm64", "windows/x86_64"] })
  updated!: string[];
}
