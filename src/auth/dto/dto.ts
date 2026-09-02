import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class AuthDto {
  @ApiProperty({ example: "john" })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ example: "secret123", minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

export class AuthRefreshDto {
  @ApiProperty({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  @IsString()
  refresh_token!: string;
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
