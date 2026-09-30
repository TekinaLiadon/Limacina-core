import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { validationMessages } from "../../common/validation-messages";
import { MAX_USERNAME_LENGTH, USERNAME_PATTERN } from "../../common/username-policy";
import { MIN_PASSWORD_LENGTH } from "../password-policy";

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

  @ApiProperty({ example: "secret123", minLength: MIN_PASSWORD_LENGTH, maxLength: 128 })
  @IsString({ message: validationMessages.string("password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("password") })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: validationMessages.minLength("password", MIN_PASSWORD_LENGTH),
  })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
  password!: string;
}

export class AuthDto {
  @ApiProperty({ example: "john", maxLength: MAX_USERNAME_LENGTH })
  @IsString({ message: validationMessages.string("username") })
  @IsNotEmpty({ message: validationMessages.notEmpty("username") })
  @MaxLength(MAX_USERNAME_LENGTH, {
    message: validationMessages.maxLength("username", MAX_USERNAME_LENGTH),
  })
  username!: string;

  @ApiProperty({ example: "secret123", minLength: 3, maxLength: 128 })
  @IsString({ message: validationMessages.string("password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("password") })
  @MinLength(3, { message: validationMessages.minLength("password", 3) })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
  password!: string;
}

export class AuthRefreshDto {
  @ApiProperty({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  @IsString({ message: validationMessages.string("refresh_token") })
  refresh_token!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "secret123", minLength: MIN_PASSWORD_LENGTH, maxLength: 128 })
  @IsString({ message: validationMessages.string("old_password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("old_password") })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: validationMessages.minLength("old_password", MIN_PASSWORD_LENGTH),
  })
  @MaxLength(128, { message: validationMessages.maxLength("old_password", 128) })
  old_password!: string;

  @ApiProperty({ example: "newsecret123", minLength: MIN_PASSWORD_LENGTH, maxLength: 128 })
  @IsString({ message: validationMessages.string("new_password") })
  @IsNotEmpty({ message: validationMessages.notEmpty("new_password") })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: validationMessages.minLength("new_password", MIN_PASSWORD_LENGTH),
  })
  @MaxLength(128, { message: validationMessages.maxLength("new_password", 128) })
  new_password!: string;
}

export class UserTokensDto {
  @ApiProperty()
  access_token!: string;

  @ApiProperty()
  refresh_token!: string;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserTokensDto })
  tokens!: UserTokensDto;

  @ApiProperty({ example: "a1b2c3d4e5f6" })
  uuid!: string;

  @ApiProperty({ example: "john" })
  username!: string;

  @ApiProperty({ example: "user" })
  role!: string;
}
