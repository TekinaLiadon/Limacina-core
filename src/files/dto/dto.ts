import { ApiProperty } from "@nestjs/swagger";

export class FileDto {
  @ApiProperty()
  url!: string;
}

export class ListFileDataDto {
  @ApiProperty()
  list!: Record<string, string>;
}
