import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "../common/public.decorator";
import { BatchProfilesPipe } from "./batch-profiles.pipe";
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
  HasJoinedQueryDto,
  YggdrasilErrorDto,
  SessionProfileDto,
  ApiMetadataResponseDto,
  GameProfileDto,
  UploadTextureDto,
} from "./dto/dto";

@ApiTags("yggdrasil")
@Public()
@Controller("")
export class YggdrasilController {
  constructor(private readonly yggdrasilService: YggdrasilService) {}

  @Get()
  @ApiOperation({ summary: "API metadata for authlib-injector auto-configuration" })
  @ApiResponse({ status: 200, type: ApiMetadataResponseDto })
  getMetadata(): ApiMetadataResponseDto {
    return this.yggdrasilService.getMetadata();
  }

  @Post("authserver/authenticate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login with credentials" })
  @ApiBody({ type: AuthenticateDto })
  @ApiResponse({ status: 200, type: AuthenticateResponseDto })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async postAuthenticate(@Body() dto: AuthenticateDto): Promise<AuthenticateResponseDto> {
    return this.yggdrasilService.authenticate(dto);
  }

  @Post("authserver/refresh")
  @HttpCode(HttpStatus.OK)
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
  @ApiQuery({ name: "username", required: true })
  @ApiQuery({ name: "serverId", required: true })
  @ApiResponse({ status: 200, type: SessionProfileDto })
  @ApiResponse({ status: 204, description: "Session not found" })
  async getHasJoined(
    @Query() query: HasJoinedQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionProfileDto | undefined> {
    const profile = await this.yggdrasilService.hasJoined(query.username, query.serverId);
    if (!profile) {
      reply.status(HttpStatus.NO_CONTENT).send();
      return undefined;
    }
    return profile;
  }

  @Get("sessionserver/session/minecraft/profile/:uuid")
  @ApiOperation({ summary: "Get player session profile" })
  @ApiParam({ name: "uuid", description: "Player UUID (with or without dashes)" })
  @ApiQuery({
    name: "unsigned",
    required: false,
    enum: ["true", "false"],
    description: "false — вернуть текстуры с цифровой подписью; по умолчанию без подписи",
  })
  @ApiResponse({ status: 200, type: SessionProfileDto })
  @ApiResponse({ status: 204, description: "Profile not found" })
  async getProfile(
    @Param("uuid") uuid: string,
    @Query("unsigned", new DefaultValuePipe("true"), new ParseEnumPipe(["true", "false"]))
    unsigned: "true" | "false",
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionProfileDto | undefined> {
    const profile = await this.yggdrasilService.getProfile(uuid, unsigned === "false");
    if (!profile) {
      reply.status(HttpStatus.NO_CONTENT).send();
      return undefined;
    }
    return profile;
  }

  @Post("api/profiles/minecraft")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Batch query profiles by name" })
  @ApiBody({ type: [String] })
  @ApiResponse({ status: 200, type: [GameProfileDto] })
  async postBatchProfiles(
    @Body(new BatchProfilesPipe()) names: string[],
  ): Promise<GameProfileDto[]> {
    return this.yggdrasilService.batchProfiles(names);
  }

  @Put("api/user/profile/:uuid/:textureType")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity("bearer")
  @ApiOperation({ summary: "Upload texture (base64-encoded PNG in body)" })
  @ApiParam({ name: "uuid" })
  @ApiParam({ name: "textureType", enum: ["skin", "cape"] })
  @ApiBody({ type: UploadTextureDto })
  @ApiResponse({ status: 204, description: "Texture uploaded" })
  @ApiResponse({ status: 401, description: "Missing or invalid access token" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async putTexture(
    @Param("uuid") uuid: string,
    @Param("textureType", new ParseEnumPipe(["skin", "cape"])) textureType: "skin" | "cape",
    @Body() body: UploadTextureDto,
    @Headers("authorization") authorization?: string,
  ): Promise<void> {
    const buffer = Buffer.from(body.file, "base64");
    await this.yggdrasilService.uploadTexture(uuid, textureType, buffer, body.model, authorization);
  }

  @Delete("api/user/profile/:uuid/:textureType")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity("bearer")
  @ApiOperation({ summary: "Delete texture" })
  @ApiParam({ name: "uuid" })
  @ApiParam({ name: "textureType", enum: ["skin", "cape"] })
  @ApiResponse({ status: 204, description: "Texture deleted" })
  @ApiResponse({ status: 401, description: "Missing or invalid access token" })
  @ApiResponse({ status: 403, type: YggdrasilErrorDto })
  async deleteTexture(
    @Param("uuid") uuid: string,
    @Param("textureType", new ParseEnumPipe(["skin", "cape"])) textureType: "skin" | "cape",
    @Headers("authorization") authorization?: string,
  ): Promise<void> {
    await this.yggdrasilService.deleteTexture(uuid, textureType, authorization);
  }
}
