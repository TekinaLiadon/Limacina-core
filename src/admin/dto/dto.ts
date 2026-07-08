import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

export class UnapprovedUsersQueryDto {
  @ApiProperty({ default: 10, minimum: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
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

export class UserListItemDto {
  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "user" })
  role!: string;

  @ApiProperty({ example: false })
  banned!: boolean;
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

  @ApiProperty({ default: 100, minimum: 1, maximum: 1000, description: "Максимум строк на страницу" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
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
      '{"level":30,"time":1751971200000,"msg":"Запуск...","App":"App"}',
      '{"level":30,"time":1751971201000,"msg":"Сервер запущен на порту 3005","App":"App"}',
    ],
  })
  lines!: string[];
}
