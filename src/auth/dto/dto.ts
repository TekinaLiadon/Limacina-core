import { ApiProperty } from "@nestjs/swagger";
import { IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class AuthDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "secret123" })
  @IsString()
  password!: string;
}

export class ProfilePropertyDto {
  @ApiProperty({ example: "textures" })
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  value!: string;
}

export class GameProfileDto {
  @ApiProperty({ example: "a1b2c3d4e5f67890abcdef1234567890" })
  @IsString()
  id!: string;

  @ApiProperty({ example: "player1" })
  @IsString()
  name!: string;

  @ApiProperty({ type: [ProfilePropertyDto] })
  @ValidateNested({ each: true })
  @Type(() => ProfilePropertyDto)
  properties!: ProfilePropertyDto[];
}

export class YggUserDto {
  @ApiProperty({ example: "a1b2c3d4e5f67890abcdef1234567890" })
  id!: string;

  @ApiProperty({ type: [ProfilePropertyDto], default: [] })
  properties!: ProfilePropertyDto[];
}

export class RefreshDto {
  @ApiProperty({ description: "Refresh token (JWT)" })
  @IsString()
  refresh_token!: string;
}

export class RefreshResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  clientToken!: string;
}

export class UserTokens {
  @ApiProperty()
  access_token!: string;

  @ApiProperty()
  refresh_token!: string;
}

export class UserProfile {
  @ApiProperty({ example: "a1b2c3d4e5f6" })
  uuid!: string;

  @ApiProperty({ example: "john" })
  username!: string;
}

export class ProfileInfo {
  @ApiProperty({ type: UserTokens })
  tokens!: UserTokens;

  @ApiProperty({ type: UserProfile })
  profile!: UserProfile;
}

export class UserInfo {
  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "secret123" })
  password!: string;
}
