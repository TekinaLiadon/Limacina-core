import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { validationMessages } from "../../common/validation-messages";

export class AgentDto {
  @ApiProperty({ example: "Minecraft" })
  @IsString({ message: validationMessages.string("agent.name") })
  name!: string;

  @ApiProperty({ example: 1 })
  @IsNumber({}, { message: validationMessages.number("agent.version") })
  version!: number;
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

export class AuthenticateDto {
  @ApiPropertyOptional({ type: AgentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentDto)
  agent?: AgentDto;

  @ApiProperty({ example: "player1", maxLength: 64 })
  @IsString({ message: validationMessages.string("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
  username!: string;

  @ApiProperty({ example: "secret123", maxLength: 128 })
  @IsString({ message: validationMessages.string("password") })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
  password!: string;

  @ApiPropertyOptional({ example: "client-token-123", maxLength: 512 })
  @IsOptional()
  @IsString({ message: validationMessages.string("clientToken") })
  @MaxLength(512, { message: validationMessages.maxLength("clientToken", 512) })
  clientToken?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: validationMessages.boolean("requestUser") })
  requestUser?: boolean;
}

export class RefreshDto {
  @ApiProperty({ maxLength: 512 })
  @IsString({ message: validationMessages.string("accessToken") })
  @MaxLength(512, { message: validationMessages.maxLength("accessToken", 512) })
  accessToken!: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString({ message: validationMessages.string("clientToken") })
  @MaxLength(512, { message: validationMessages.maxLength("clientToken", 512) })
  clientToken?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: validationMessages.boolean("requestUser") })
  requestUser?: boolean;

  @ApiPropertyOptional({ type: GameProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GameProfileDto)
  selectedProfile?: GameProfileDto;
}

export class ValidateDto {
  @ApiProperty({ maxLength: 512 })
  @IsString({ message: validationMessages.string("accessToken") })
  @MaxLength(512, { message: validationMessages.maxLength("accessToken", 512) })
  accessToken!: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString({ message: validationMessages.string("clientToken") })
  @MaxLength(512, { message: validationMessages.maxLength("clientToken", 512) })
  clientToken?: string;
}

export class InvalidateDto {
  @ApiProperty({ maxLength: 512 })
  @IsString({ message: validationMessages.string("accessToken") })
  @MaxLength(512, { message: validationMessages.maxLength("accessToken", 512) })
  accessToken!: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString({ message: validationMessages.string("clientToken") })
  @MaxLength(512, { message: validationMessages.maxLength("clientToken", 512) })
  clientToken?: string;
}

export class SignoutDto {
  @ApiProperty({ example: "player1", maxLength: 64 })
  @IsString({ message: validationMessages.string("username") })
  @MaxLength(64, { message: validationMessages.maxLength("username", 64) })
  username!: string;

  @ApiProperty({ example: "secret123", maxLength: 128 })
  @IsString({ message: validationMessages.string("password") })
  @MaxLength(128, { message: validationMessages.maxLength("password", 128) })
  password!: string;
}

export class JoinDto {
  @ApiProperty({ maxLength: 512 })
  @IsString({ message: validationMessages.string("accessToken") })
  @MaxLength(512, { message: validationMessages.maxLength("accessToken", 512) })
  accessToken!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString({ message: validationMessages.string("selectedProfile") })
  @MaxLength(64, { message: validationMessages.maxLength("selectedProfile", 64) })
  selectedProfile!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString({ message: validationMessages.string("serverId") })
  @MaxLength(64, { message: validationMessages.maxLength("serverId", 64) })
  serverId!: string;
}

export class YggUserDto {
  @ApiProperty({ example: "a1b2c3d4e5f67890abcdef1234567890" })
  id!: string;

  @ApiProperty({ type: [ProfilePropertyDto], default: [] })
  properties!: ProfilePropertyDto[];
}

export class AuthenticateResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  clientToken!: string;

  @ApiProperty({ type: [GameProfileDto] })
  availableProfiles!: GameProfileDto[];

  @ApiProperty({ type: GameProfileDto, required: false })
  selectedProfile?: GameProfileDto;

  @ApiProperty({ type: YggUserDto, required: false })
  user?: YggUserDto;
}

export class RefreshResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  clientToken!: string;

  @ApiProperty({ type: GameProfileDto, required: false })
  selectedProfile?: GameProfileDto;

  @ApiProperty({ type: YggUserDto, required: false })
  user?: YggUserDto;
}

export class YggdrasilErrorDto {
  @ApiProperty({ example: "ForbiddenOperationException" })
  error!: string;

  @ApiProperty({ example: "Invalid credentials. Invalid username or password." })
  errorMessage!: string;

  @ApiPropertyOptional()
  cause?: string;
}

export class SessionProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [ProfilePropertyDto] })
  properties!: ProfilePropertyDto[];
}

export class ApiMetaLinksDto {
  @ApiPropertyOptional()
  homepage?: string;

  @ApiPropertyOptional()
  register?: string;
}

export class ApiMetaDto {
  @ApiPropertyOptional()
  serverName?: string;

  @ApiPropertyOptional()
  implementationName?: string;

  @ApiPropertyOptional()
  implementationVersion?: string;

  @ApiPropertyOptional({ type: ApiMetaLinksDto })
  links?: ApiMetaLinksDto;
}

export class ApiMetadataResponseDto {
  @ApiProperty({ type: ApiMetaDto })
  meta!: ApiMetaDto;

  @ApiProperty({ type: [String] })
  skinDomains!: string[];

  @ApiProperty()
  signaturePublickey!: string;
}

export class UploadTextureDto {
  @ApiPropertyOptional({
    example: "slim",
    description: "Модель скина (slim/classic)",
    maxLength: 16,
  })
  @IsOptional()
  @IsString({ message: validationMessages.string("model") })
  @MaxLength(16, { message: validationMessages.maxLength("model", 16) })
  model?: string;

  @ApiProperty({ description: "PNG в base64", maxLength: 700000 })
  @IsString({ message: validationMessages.string("file") })
  @MaxLength(700000, { message: validationMessages.maxLength("file", 700000) })
  file!: string;
}
