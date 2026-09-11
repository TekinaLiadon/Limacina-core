import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt } from "class-validator";
import { validationMessages } from "../../common/validation-messages";

export class UserContentItemDto {
  @ApiPropertyOptional({ example: 1, description: "null для скина по умолчанию" })
  id!: number | null;

  @ApiProperty({ example: "http://localhost:3005/textures/a1b2c3d4.png" })
  url!: string;

  @ApiPropertyOptional({
    example: "slim",
    enum: ["classic", "slim"],
    description: "Модель рук скина (только для скинов)",
  })
  model?: string | null;

  @ApiPropertyOptional({
    example: false,
    description: "Активен ли скин (только для скинов; дефолтный скин всегда активен)",
  })
  active?: boolean;
}

export class UserContentUploadResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: "http://localhost:3005/textures/a1b2c3d4.png" })
  url!: string;
}

export class SetActiveSkinDto {
  @IsInt({ message: validationMessages.int("id") })
  @ApiProperty({ example: 1, description: "ID скина из списка скинов" })
  id!: number;
}
