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

export class ModFileDto {
  @ApiProperty({ description: "Имя файла мода", example: "jei-1.21.1-19.21.0.247.jar" })
  name!: string;

  @ApiProperty({ description: "Размер файла в байтах", example: 2938475 })
  size!: number;
}

export class ModsListResponseDto {
  @ApiProperty({
    type: [ModFileDto],
    description: "Файлы в папке модов лаунчера (по алфавиту)",
  })
  mods!: ModFileDto[];
}

export class ModsUploadResponseDto {
  @ApiProperty({
    type: [String],
    description: "Имена загруженных файлов",
    example: ["jei-1.21.1-19.21.0.247.jar"],
  })
  uploaded!: string[];
}

export const fileListResponseSchema = {
  type: "object",
  additionalProperties: { type: "string" },
  example: { "mods/mod.jar": "d41d8cd98f00b204e9800998ecf8427e" },
} as const;
