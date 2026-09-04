import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, Min } from "class-validator";

export class MinecraftStatusDto {
  @ApiProperty({ description: "Игроков онлайн", example: 7 })
  @IsInt()
  @Min(0)
  online!: number;

  @ApiProperty({ description: "Максимум игроков", example: 20 })
  @IsInt()
  @Min(0)
  max!: number;

  @ApiProperty({ description: "Версия игрового сервера", example: "1.21.4" })
  @IsString()
  version!: string;
}
