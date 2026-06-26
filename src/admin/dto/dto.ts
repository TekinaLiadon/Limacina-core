import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  password_hash: string;
  skin_url: string | null;
  role: string;
  approved: boolean;
}

export class UnapprovedUsersQueryDto {
  @ApiProperty({ default: 10, minimum: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(50)
  limit?: number;
}

export class ApproveUserDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  approved!: boolean;
}
