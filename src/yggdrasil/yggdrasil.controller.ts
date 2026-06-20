import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { YggdrasilService } from "./service/yggdrasil.service";
import {
  AuthenticateDto,
  AuthenticateResponseDto,
  RefreshDto,
  RefreshResponseDto,
  ValidateDto,
  InvalidateDto,
  SignoutDto,
  JoinDto,
  YggdrasilErrorDto,
  SessionProfileDto,
  ApiMetadataResponseDto,
  GameProfileDto,
} from "./dto/dto";

class UploadTextureDto {
  model?: string;
  file!: string;
}

@ApiTags("yggdrasil")
@Controller("")
export class YggdrasilController {
  constructor(private readonly yggdrasilService: YggdrasilService) {}

  @Get()
  @ApiOperation({ summary: "API metadata for authlib-injector auto-configuration" })
  @ApiResponse({ status: 200, type: ApiMetadataResponseDto })
  getMetadata() {
    return this.yggdrasilService.getMetadata();
  }

  @Post("authserver/authenticate")
  @ApiOperation({ summary: "Login with credentials" })
  @ApiBody({ type: AuthenticateDto })
  @ApiResponse({ status: 200, type: AuthenticateResponseDto })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postAuthenticate(@Body() dto: AuthenticateDto): Promise<AuthenticateResponseDto> {
    return this.yggdrasilService.authenticate(dto);
  }

  @Post("authserver/refresh")
  @ApiOperation({ summary: "Refresh token" })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postRefresh(@Body() dto: RefreshDto): Promise<RefreshResponseDto> {
    return this.yggdrasilService.refresh(dto);
  }

  @Post("authserver/validate")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Validate token" })
  @ApiBody({ type: ValidateDto })
  @ApiResponse({ status: 204, description: "Token is valid" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postValidate(@Body() dto: ValidateDto): Promise<void> {
    await this.yggdrasilService.validate(dto);
  }

  @Post("authserver/invalidate")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke token" })
  @ApiBody({ type: InvalidateDto })
  @ApiResponse({ status: 204, description: "Token revoked" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postInvalidate(@Body() dto: InvalidateDto): Promise<void> {
    await this.yggdrasilService.invalidate(dto);
  }

  @Post("authserver/signout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke all tokens for a user" })
  @ApiBody({ type: SignoutDto })
  @ApiResponse({ status: 204, description: "All tokens revoked" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postSignout(@Body() dto: SignoutDto): Promise<void> {
    await this.yggdrasilService.signout(dto);
  }

  @Post("sessionserver/session/minecraft/join")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Client joins server" })
  @ApiBody({ type: JoinDto })
  @ApiResponse({ status: 204, description: "Session recorded" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postJoin(@Body() dto: JoinDto): Promise<void> {
    await this.yggdrasilService.join(dto);
  }

  @Get("sessionserver/session/minecraft/hasJoined")
  @ApiOperation({ summary: "Server verifies client session" })
  @ApiQuery({ name: "username" })
  @ApiQuery({ name: "serverId" })
  @ApiQuery({ name: "ip", required: false })
  @ApiResponse({ status: 200, type: SessionProfileDto })
  @ApiResponse({ status: 204, description: "Session not found" })
  async getHasJoined(
    @Query("username") username: string,
    @Query("serverId") serverId: string,
    @Query("ip") ip?: string,
  ): Promise<SessionProfileDto> {
    const profile = await this.yggdrasilService.hasJoined(username, serverId, ip);
    if (!profile) {
      throw new NotFoundException("Session not found");
    }
    return profile;
  }

  @Get("sessionserver/session/minecraft/profile/:uuid")
  @ApiOperation({ summary: "Get player session profile" })
  @ApiParam({ name: "uuid", description: "Player UUID (with or without dashes)" })
  @ApiQuery({ name: "unsigned", required: false })
  @ApiResponse({ status: 200, type: SessionProfileDto })
  @ApiResponse({ status: 204, description: "Profile not found" })
  async getProfile(@Param("uuid") uuid: string): Promise<SessionProfileDto> {
    const profile = await this.yggdrasilService.getProfile(uuid);
    if (!profile) {
      throw new NotFoundException("Profile not found");
    }
    return profile;
  }

  @Post("api/profiles/minecraft")
  @ApiOperation({ summary: "Batch query profiles by name" })
  @ApiBody({ type: [String] })
  @ApiResponse({ status: 200, type: [GameProfileDto] })
  async postBatchProfiles(@Body() names: string[]): Promise<GameProfileDto[]> {
    return this.yggdrasilService.batchProfiles(names);
  }

  @Put("api/user/profile/:uuid/:textureType")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Upload texture (base64-encoded PNG in body)" })
  @ApiParam({ name: "uuid" })
  @ApiParam({ name: "textureType", enum: ["skin", "cape"] })
  @ApiBody({ type: UploadTextureDto })
  @ApiResponse({ status: 204, description: "Texture uploaded" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async putTexture(
    @Param("uuid") uuid: string,
    @Param("textureType") textureType: "skin" | "cape",
    @Body() body: UploadTextureDto,
  ): Promise<void> {
    const buffer = Buffer.from(body.file, "base64");
    await this.yggdrasilService.uploadTexture(uuid, textureType, buffer, body.model);
  }

  @Delete("api/user/profile/:uuid/:textureType")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete texture" })
  @ApiParam({ name: "uuid" })
  @ApiParam({ name: "textureType", enum: ["skin", "cape"] })
  @ApiResponse({ status: 204, description: "Texture deleted" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async deleteTexture(
    @Param("uuid") uuid: string,
    @Param("textureType") textureType: "skin" | "cape",
  ): Promise<void> {
    await this.yggdrasilService.deleteTexture(uuid, textureType);
  }
}
