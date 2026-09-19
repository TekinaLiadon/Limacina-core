import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";
import { validationMessages } from "../../common/validation-messages";
import { LimitQuery, OffsetQuery } from "../../common/dto/dto";

export class FileDto {
  @ApiProperty()
  @IsString({ message: validationMessages.string("url") })
  url!: string;
}

export class FilesListQueryDto {
  @ApiProperty({
    required: false,
    minimum: 0,
    default: 0,
    description: "Смещение от начала отсортированного списка",
  })
  @OffsetQuery()
  offset?: number;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 1000,
    description: "Максимум записей в ответе (без параметра — весь список)",
  })
  @LimitQuery(1000)
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
