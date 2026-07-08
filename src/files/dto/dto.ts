import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class FileDto {
  @ApiProperty()
  @IsString()
  url!: string;
}
