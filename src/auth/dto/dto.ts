import { ApiProperty } from "@nestjs/swagger";

export class AuthDto {
  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "secret123" })
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  refresh_token!: string;
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
