import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AgentDto {
  @ApiProperty({ example: "Minecraft" })
  name!: string;

  @ApiProperty({ example: 1 })
  version!: number;
}

export class ProfilePropertyDto {
  @ApiProperty({ example: "textures" })
  name!: string;

  @ApiProperty()
  value!: string;
}

export class GameProfileDto {
  @ApiProperty({ example: "a1b2c3d4e5f67890abcdef1234567890" })
  id!: string;

  @ApiProperty({ example: "player1" })
  name!: string;

  @ApiProperty({ type: [ProfilePropertyDto] })
  properties!: ProfilePropertyDto[];
}

export class AuthenticateDto {
  @ApiPropertyOptional({ type: AgentDto })
  agent?: AgentDto;

  @ApiProperty({ example: "player1" })
  username!: string;

  @ApiProperty({ example: "secret123" })
  password!: string;

  @ApiPropertyOptional({ example: "client-token-123" })
  clientToken?: string;

  @ApiPropertyOptional({ default: true })
  requestUser?: boolean;
}

export class RefreshDto {
  @ApiProperty()
  accessToken!: string;

  @ApiPropertyOptional()
  clientToken?: string;

  @ApiPropertyOptional({ default: true })
  requestUser?: boolean;

  @ApiPropertyOptional({ type: GameProfileDto })
  selectedProfile?: GameProfileDto;
}

export class ValidateDto {
  @ApiProperty()
  accessToken!: string;

  @ApiPropertyOptional()
  clientToken?: string;
}

export class InvalidateDto {
  @ApiProperty()
  accessToken!: string;

  @ApiPropertyOptional()
  clientToken?: string;
}

export class SignoutDto {
  @ApiProperty({ example: "player1" })
  username!: string;

  @ApiProperty({ example: "secret123" })
  password!: string;
}

export class JoinDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  selectedProfile!: string;

  @ApiProperty()
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
