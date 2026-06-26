import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class FileDto {
  @ApiProperty()
  @IsString()
  url!: string;
}

export class ListFileDataDto {
  @ApiProperty()
  list!: Record<string, string>;
}
