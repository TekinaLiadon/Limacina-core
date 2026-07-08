import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class AuthDto {
  @ApiProperty({ example: "john" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "secret123" })
  @IsString()
  password!: string;
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

export class AuthResponseDto {
  @ApiProperty({ type: UserTokens })
  tokens!: UserTokens;

  @ApiProperty({ example: "a1b2c3d4e5f6" })
  uuid!: string;

  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "user" })
  role!: string;
}
