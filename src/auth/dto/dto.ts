import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { validationMessages } from "../../common/validation-messages";

export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export class RegisterDto {
  @ApiProperty({
    example: "john_doe",
    minLength: 3,
    maxLength: 16,
    pattern: String(USERNAME_PATTERN),
    description: "3–16 символов: латиница, цифры и _",
  })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MinLength(3, { message: validationMessages.minLength("username", 3) })
  @MaxLength(16, { message: validationMessages.maxLength("username", 16) })
  @Matches(USERNAME_PATTERN, { message: validationMessages.usernamePattern })
  username!: string;

  @ApiProperty({ example: "secret123", minLength: 6, maxLength: 128 })
  @IsString({ message: validationMessages.string("password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("password") })
  @MinLength(6, { message: validationMessages.minLength("password", 6) })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
  password!: string;
}

export class AuthDto {
  @ApiProperty({ example: "john" })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  username!: string;

  @ApiProperty({ example: "secret123", minLength: 6 })
  @IsString({ message: validationMessages.string("password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("password") })
  @MinLength(6, { message: validationMessages.minLength("password", 6) })
  password!: string;
}

export class AuthRefreshDto {
  @ApiProperty({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  @IsString({ message: validationMessages.string("refresh_token") })
  refresh_token!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "secret123", minLength: 6 })
  @IsString({ message: validationMessages.string("old_password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("old_password") })
  @MinLength(6, { message: validationMessages.minLength("old_password", 6) })
  old_password!: string;

  @ApiProperty({ example: "newsecret123", minLength: 6 })
  @IsString({ message: validationMessages.string("new_password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("new_password") })
  @MinLength(6, { message: validationMessages.minLength("new_password", 6) })
  new_password!: string;
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
