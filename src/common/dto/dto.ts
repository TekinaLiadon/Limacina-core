import { ApiProperty } from "@nestjs/swagger";

export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}

export class UserSuccessResponseDto extends SuccessResponseDto {
  @ApiProperty({ example: "john" })
  username!: string;
}
