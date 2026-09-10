import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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
}

export class UserContentUploadResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: "http://localhost:3005/textures/a1b2c3d4.png" })
  url!: string;
}
