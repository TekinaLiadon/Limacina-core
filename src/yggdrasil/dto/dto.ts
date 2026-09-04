import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
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

  @ApiProperty({ example: "player1" })
  @IsString({ message: validationMessages.string("username") })
  username!: string;

  @ApiProperty({ example: "secret123" })
  @IsString({ message: validationMessages.string("password") })
  password!: string;

  @ApiPropertyOptional({ example: "client-token-123" })
  @IsOptional()
  @IsString({ message: validationMessages.string("clientToken") })
  clientToken?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: validationMessages.boolean("requestUser") })
  requestUser?: boolean;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  accessToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientToken?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requestUser?: boolean;

  @ApiPropertyOptional({ type: GameProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GameProfileDto)
  selectedProfile?: GameProfileDto;
}

export class ValidateDto {
  @ApiProperty()
  @IsString()
  accessToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientToken?: string;
}

export class InvalidateDto {
  @ApiProperty()
  @IsString()
  accessToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientToken?: string;
}

export class SignoutDto {
  @ApiProperty({ example: "player1" })
  @IsString()
  username!: string;

  @ApiProperty({ example: "secret123" })
  @IsString()
  password!: string;
}

export class JoinDto {
  @ApiProperty()
  @IsString({ message: validationMessages.string("accessToken") })
  accessToken!: string;

  @ApiProperty()
  @IsString({ message: validationMessages.string("selectedProfile") })
  selectedProfile!: string;

  @ApiProperty()
  @IsString({ message: validationMessages.string("serverId") })
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
  @ApiPropertyOptional({ example: "slim", description: "Модель скина (slim/classic)" })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ description: "PNG в base64" })
  @IsString()
  file!: string;
}
