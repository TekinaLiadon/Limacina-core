import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { validationMessages } from "../../common/validation-messages";

export class FileDto {
  @ApiProperty()
  @IsString()
  url!: string;
}

export class FilesListQueryDto {
  @ApiProperty({
    required: false,
    minimum: 0,
    default: 0,
    description: "Смещение от начала отсортированного списка",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("offset") })
  @Min(0, { message: validationMessages.min("offset", 0) })
  offset?: number;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 1000,
    description: "Максимум записей в ответе (без параметра — весь список)",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: validationMessages.int("limit") })
  @Min(1, { message: validationMessages.min("limit", 1) })
  @Max(1000, { message: validationMessages.max("limit", 1000) })
  limit?: number;
}

export class FileListResponseDto {
  [filePath: string]: string;
}

export const fileListResponseSchema = {
  type: "object",
  additionalProperties: { type: "string" },
  example: { "mods/mod.jar": "d41d8cd98f00b204e9800998ecf8427e" },
} as const;
