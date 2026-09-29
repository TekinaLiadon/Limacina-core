import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sign } from "node:crypto";
import { generateUuid } from "../../utils/uuid";
import type {
  ApiMetadataResponseDto,
  AuthenticateDto,
  AuthenticateResponseDto,
  RefreshDto,
  RefreshResponseDto,
  ValidateDto,
  InvalidateDto,
  SignoutDto,
  JoinDto,
  GameProfileDto,
  SessionProfileDto,
} from "../dto/dto";
import {
  YggdrasilStoreToken,
  YggdrasilTokenStoreToken,
  YggdrasilSessionStoreToken,
  type IYggdrasilStore,
  type IYggdrasilTokenStore,
  type IYggdrasilSessionStore,
  type YggdrasilProfile,
  type YggdrasilTextures,
  type YggdrasilUserCredentials,
  type TokenEntry,
} from "./yggdrasil_store";
import { issuedBeforePasswordChange, type JwtAccessPayload } from "../../common/jwt.strategy";
import { MAX_PROFILE_NAMES } from "../batch-profiles.pipe";
import {
  UserContentStoreToken,
  type IUserContentStore,
} from "../../user-content/user_content_store";
import { AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import { resolveKeysDir } from "./keys-dir";
import { sanitizeFilePrefix } from "../../utils/file-prefix";
import {
  TEXTURE_DIRECTORIES,
  buildContentLocation,
  releaseContentFile,
} from "../../utils/content-files";
import { buildDefaultSkinUrl, isSkinModel, textureFileIssue } from "../../utils/texture";
import { sanitizePng } from "../../utils/png";
import { lastById } from "../../utils/collection";
import { withPathLock } from "../../utils/path-lock";

type TextureAccessPrincipal =
  | { kind: "token"; entry: TokenEntry }
  | { kind: "jwt"; payload: JwtAccessPayload };

interface PreparedAuthResponse {
  accessToken: string;
  clientToken: string;
  selected: YggdrasilProfile | undefined;
  response: AuthenticateResponseDto;
}

export interface TextureProperty {
  name: string;
  value: string;
  signature?: string;
}

function buildUploadableTexturesProperty(): TextureProperty {
  return {
    name: "uploadableTextures",
    value: "skin,cape",
  };
}

const IPV4_HOST_PATTERN = /^(\d{1,3})(\.\d{1,3}){3}$/;

function resolveSkinWildcardDomain(host: string): string | null {
  if (host.includes(":") || IPV4_HOST_PATTERN.test(host)) return null;
  const firstDot = host.indexOf(".");
  if (firstDot === -1) return null;
  if (!host.includes(".", firstDot + 1)) return `.${host}`;
  return host.slice(firstDot);
}

@Injectable()
export class YggdrasilService {
  private readonly logger = new Logger(YggdrasilService.name);
  private readonly defaultSkinUrl: string;
  private readonly jwtSecret: string;
  private readonly privateKey: string;
  private readonly publicKeyPem: string;
  private dummyPasswordHash: Promise<string> | undefined;

  constructor(
    @Inject(YggdrasilStoreToken) private readonly store: IYggdrasilStore,
    @Inject(YggdrasilTokenStoreToken) private readonly tokenStore: IYggdrasilTokenStore,
    @Inject(YggdrasilSessionStoreToken) private readonly sessionStore: IYggdrasilSessionStore,
    @Inject(UserContentStoreToken) private readonly contentStore: IUserContentStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
    private readonly jwtService: JwtService,
  ) {
    this.defaultSkinUrl = buildDefaultSkinUrl(config.BASE_URL);
    this.jwtSecret = config.JWT_ACCESS;

    const keysDir = resolveKeysDir(config.KEYS_DIR);
    const privateKeyPath = join(keysDir, "private.pem");
    const publicKeyPath = join(keysDir, "public.pem");
    this.privateKey = existsSync(privateKeyPath) ? readFileSync(privateKeyPath, "utf-8") : "";
    this.publicKeyPem = existsSync(publicKeyPath) ? readFileSync(publicKeyPath, "utf-8") : "";

    if (!this.publicKeyPem || !this.privateKey) {
      this.logger.error(
        { keysDir },
        "Yggdrasil texture signing keys not found — texture signatures are disabled. Run `bun run generate:keypair` or set KEYS_DIR.",
      );
    }
  }

  private createError(
    message: { info: string },
    context: string,
    errorMessage: string,
    error: string = "ForbiddenOperationException",
    status: HttpStatus = HttpStatus.FORBIDDEN,
  ): HttpException {
    this.logger.warn(message, context);
    return new HttpException(
      {
        error,
        errorMessage,
      },
      status,
    );
  }

  private async matchPasswordVerifyTiming(password: string): Promise<void> {
    this.dummyPasswordHash ??= Bun.password.hash(generateUuid());
    await Bun.password.verify(password, await this.dummyPasswordHash);
  }

  async authenticate(dto: AuthenticateDto): Promise<AuthenticateResponseDto> {
    const user = await this.store.findUserByUsername(dto.username);
    if (!user) {
      await this.matchPasswordVerifyTiming(dto.password);
      throw this.createError(
        { info: dto.username },
        "user not found",
        "Invalid credentials. Invalid username or password.",
      );
    }

    const valid = await Bun.password.verify(dto.password, user.passwordHash);
    if (!valid)
      throw this.createError(
        { info: dto.username },
        "invalid password",
        "Invalid credentials. Invalid username or password.",
      );

    if (user.banned || !user.approved)
      throw this.createError(
        { info: dto.username },
        "user banned or not approved",
        "Invalid credentials. Invalid username or password.",
      );

    const profiles = await this.store.findProfilesByUserId(user.uuid);
    if (profiles.length === 0)
      throw this.createError(
        { info: dto.username },
        "no profiles",
        "Invalid credentials. Invalid username or password.",
      );

    const prepared = await this.prepareAuthResponse(
      user.uuid,
      profiles,
      dto.clientToken,
      dto.requestUser,
    );
    await this.tokenStore.saveToken(prepared.accessToken, {
      profileId: prepared.selected?.uuid ?? null,
      username: prepared.selected?.username ?? profiles[0]?.username ?? "",
      clientToken: prepared.clientToken,
      userId: user.uuid,
    });
    return prepared.response;
  }

  async refresh(dto: RefreshDto): Promise<RefreshResponseDto> {
    const entry = await this.tokenStore.findToken(dto.accessToken);
    if (!entry || (dto.clientToken && dto.clientToken !== entry.clientToken))
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    const profiles = await this.store.findProfilesByUserId(entry.userId);

    let selectedProfile: string | undefined = entry.profileId ?? undefined;
    if (dto.selectedProfile) {
      const requestedProfileId = dto.selectedProfile.id;
      if (entry.profileId)
        throw this.createError(
          { info: "***" },
          "invalid token",
          "Access token already has a profile assigned.",
          "IllegalArgumentException",
          HttpStatus.BAD_REQUEST,
        );
      if (!profiles.some((profile) => profile.uuid === requestedProfileId))
        throw this.createError(
          { info: "***" },
          "invalid selectedProfile",
          "Invalid profile.",
          "IllegalArgumentException",
          HttpStatus.BAD_REQUEST,
        );
      selectedProfile = requestedProfileId;
    }

    const user = await this.findActiveUserByUsername(entry.username);

    const prepared = await this.prepareAuthResponse(
      user.uuid,
      profiles,
      dto.clientToken ?? entry.clientToken,
      dto.requestUser,
      selectedProfile,
    );

    const claimed = await this.tokenStore.claimToken(dto.accessToken);
    if (!claimed) throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    try {
      await this.tokenStore.saveToken(prepared.accessToken, {
        profileId: prepared.selected?.uuid ?? null,
        username: prepared.selected?.username ?? profiles[0]?.username ?? "",
        clientToken: prepared.clientToken,
        userId: user.uuid,
      });
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.uuid },
        "Не удалось сохранить новую пару токенов после списания старой — токен восстанавливается",
      );
      try {
        await this.tokenStore.saveToken(dto.accessToken, claimed);
      } catch (restoreError) {
        this.logger.error(
          { err: restoreError, userId: user.uuid },
          "Не удалось восстановить списанный токен после сбоя сохранения",
        );
      }
      throw error;
    }
    return prepared.response;
  }

  async validate(dto: ValidateDto): Promise<void> {
    const entry = await this.tokenStore.findToken(dto.accessToken);
    if (!entry || (dto.clientToken && dto.clientToken !== entry?.clientToken))
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    await this.findActiveUserByUsername(entry.username);
  }

  async invalidate(dto: InvalidateDto): Promise<void> {
    const entry = await this.tokenStore.findToken(dto.accessToken);
    if (entry && dto.clientToken && dto.clientToken !== entry.clientToken)
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    await this.tokenStore.deleteToken(dto.accessToken);
  }

  async signout(dto: SignoutDto): Promise<void> {
    const user = await this.store.findUserByUsername(dto.username);
    if (!user) {
      await this.matchPasswordVerifyTiming(dto.password);
      throw this.createError(
        { info: dto.username },
        "invalid credentials",
        "Invalid credentials. Invalid username or password.",
      );
    }

    const valid = await Bun.password.verify(dto.password, user.passwordHash);
    if (!valid)
      throw this.createError(
        { info: dto.username },
        "invalid credentials",
        "Invalid credentials. Invalid username or password.",
      );

    await this.tokenStore.deleteTokensByUserId(user.uuid);
  }

  async join(dto: JoinDto): Promise<void> {
    const entry = await this.tokenStore.findToken(dto.accessToken);

    if (!entry) {
      const jwtPayload = await this.verifyAccessJwt(dto.accessToken, HttpStatus.FORBIDDEN);
      await this.sessionStore.saveSession(dto.serverId, {
        profileId: dto.selectedProfile,
        username: jwtPayload.username,
      });
      return;
    }

    if (entry.profileId !== dto.selectedProfile)
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    await this.findActiveUserByUsername(entry.username);
    await this.sessionStore.saveSession(dto.serverId, {
      profileId: dto.selectedProfile,
      username: entry.username,
    });
  }

  private async findActiveUserByUsername(username: string): Promise<YggdrasilUserCredentials> {
    const user = await this.store.findUserByUsername(username);
    if (!user || user.banned || !user.approved)
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");
    return user;
  }

  private async verifyAccessToken(token: string): Promise<JwtAccessPayload | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: this.jwtSecret,
      });
      if (payload.typ !== "access") return null;
      return payload;
    } catch {
      return null;
    }
  }

  private async verifyAccessJwt(
    token: string,
    invalidStatus: HttpStatus,
  ): Promise<JwtAccessPayload> {
    const payload = await this.verifyAccessToken(token);
    if (!payload)
      throw this.createError(
        { info: "***" },
        "invalid token",
        "Invalid token.",
        "ForbiddenOperationException",
        invalidStatus,
      );

    const user = await this.findActiveUserByUsername(payload.username);
    if (issuedBeforePasswordChange(payload, user.passwordChangedAt))
      throw this.createError({ info: "***" }, "stale access token", "Invalid token.");
    return payload;
  }

  async hasJoined(username: string, serverId: string): Promise<SessionProfileDto | null> {
    const session = await this.sessionStore.findSession(serverId);
    if (!session) return null;

    const profile = await this.store.findProfileByUuid(session.profileId);
    if (!profile || profile.username !== username) return null;

    return {
      id: profile.uuid,
      name: profile.username,
      properties: await this.buildTextureProperties(profile),
    };
  }

  async getProfile(uuid: string, signed: boolean): Promise<SessionProfileDto | null> {
    const normalized = uuid.replace(/-/g, "");
    const profile = await this.store.findProfileByUuid(normalized);
    if (!profile) return null;

    return {
      id: profile.uuid,
      name: profile.username,
      properties: await this.buildTextureProperties(profile, signed),
    };
  }

  async batchProfiles(names: string[]): Promise<GameProfileDto[]> {
    const limited = names.slice(0, MAX_PROFILE_NAMES);
    const profiles = await this.store.findProfilesByUsernames(limited);

    return profiles.map((p) => ({
      id: p.uuid,
      name: p.username,
      properties: [] as Array<{ name: string; value: string }>,
    }));
  }

  async uploadTexture(
    uuid: string,
    textureType: "skin" | "cape",
    file: Buffer,
    model?: string,
    authorization?: string,
  ): Promise<void> {
    const principal = await this.authenticateTextureAccess(authorization);
    const normalizedUuid = uuid.replace(/-/g, "");
    this.validateTextureFile(file, textureType);
    const skinModel = this.normalizeSkinModel(model);
    const stored = sanitizePng(file);

    await withPathLock(this.textureMutationLockKey(normalizedUuid, textureType), async () => {
      const profile = await this.store.findProfileByUuid(normalizedUuid);
      if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

      this.assertTextureOwnership(principal, profile);

      const previousUrl = textureType === "skin" ? profile.skinUrl : profile.capeUrl;
      const target = this.computeTextureTarget(stored, profile.username, normalizedUuid);
      const textures: YggdrasilTextures = this.createTextures(textureType, skinModel, target.url);

      await this.withTextureFileLocks([previousUrl, target.url], async () => {
        await this.store.updateProfileTexture(normalizedUuid, textures);
        try {
          await Bun.write(target.path, new Uint8Array(stored));
        } catch (error) {
          this.logger.error(
            { err: error, path: target.path },
            "Не удалось записать файл текстуры — откат текстуры в сторе",
          );
          await this.rollbackProfileTexture(profile, textureType);
          throw error;
        }
        await this.releaseTextureFile(previousUrl, textureType);
      });
    });
  }

  private textureMutationLockKey(uuid: string, textureType: "skin" | "cape"): string {
    return `yggdrasil-texture:${uuid}:${textureType}`;
  }

  private async withTextureFileLocks<T>(
    urls: Array<string | null | undefined>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKeys = [...new Set(urls.filter((url): url is string => !!url))].sort();
    if (lockKeys.length === 0) return fn();
    return withPathLock(lockKeys[0]!, () =>
      lockKeys.length > 1 ? withPathLock(lockKeys[1]!, fn) : fn(),
    );
  }

  private normalizeSkinModel(model?: string): string | null {
    if (model === undefined || model === null || model === "") return null;
    if (isSkinModel(model)) return model;
    throw this.createError(
      { info: model },
      "invalid model",
      "Invalid model. Supported values: classic, slim.",
      "IllegalArgumentException",
      HttpStatus.BAD_REQUEST,
    );
  }

  private validateTextureFile(file: Buffer, textureType: "skin" | "cape"): void {
    const issue = textureFileIssue(file, textureType);
    if (!issue) return;

    if (issue.kind === "size") {
      throw this.createError(
        { info: `size ${issue.bytes} bytes, max ${issue.maxBytes}` },
        "texture upload",
        `Texture file too large: ${issue.bytes} bytes (max ${issue.maxBytes}).`,
      );
    }
    if (issue.kind === "dimensions") {
      throw this.createError(
        { info: issue.message },
        "texture upload",
        `Invalid texture dimensions: ${issue.message}.`,
      );
    }
    throw this.createError(
      { info: issue.message },
      "texture upload",
      `Invalid texture file: ${issue.message}.`,
    );
  }

  private computeTextureTarget(
    file: Buffer,
    ownerUsername: string,
    fallbackPrefix: string,
  ): { url: string; path: string } {
    const prefix = sanitizeFilePrefix(ownerUsername, fallbackPrefix);
    return buildContentLocation(this.config.BASE_URL, "textures", prefix, file, "png");
  }

  private async rollbackProfileTexture(
    profile: YggdrasilProfile,
    textureType: "skin" | "cape",
  ): Promise<void> {
    const previousUrl = textureType === "skin" ? profile.skinUrl : profile.capeUrl;
    const previous = this.createTextures(textureType, profile.skinModel, previousUrl);
    try {
      await this.store.updateProfileTexture(profile.uuid, previous);
    } catch (error) {
      this.logger.error(
        { err: error, uuid: profile.uuid },
        "Не удалось откатить текстуру профиля после сбоя записи файла",
      );
    }
  }

  async deleteTexture(
    uuid: string,
    textureType: "skin" | "cape",
    authorization?: string,
  ): Promise<void> {
    const principal = await this.authenticateTextureAccess(authorization);
    const normalizedUuid = uuid.replace(/-/g, "");

    await withPathLock(this.textureMutationLockKey(normalizedUuid, textureType), async () => {
      const profile = await this.store.findProfileByUuid(normalizedUuid);
      if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

      this.assertTextureOwnership(principal, profile);

      const previousUrl = textureType === "skin" ? profile.skinUrl : profile.capeUrl;
      const textures: YggdrasilTextures = this.createTextures(textureType);
      await this.withTextureFileLocks([previousUrl], async () => {
        await this.store.updateProfileTexture(normalizedUuid, textures);
        await this.releaseTextureFile(previousUrl, textureType);
      });
    });
  }

  private async releaseTextureFile(
    url: string | null | undefined,
    textureType: "skin" | "cape",
  ): Promise<void> {
    if (!url) return;
    if (url === this.defaultSkinUrl) return;

    const contentRefs = await this.contentStore.countByFilePath(url, textureType);
    const profileRefs = await this.store.countProfilesByTextureUrl(url);
    await releaseContentFile({
      logger: this.logger,
      baseUrl: this.config.BASE_URL,
      url,
      directories: TEXTURE_DIRECTORIES,
      referenceCount: contentRefs + profileRefs,
    });
  }

  private async authenticateTextureAccess(authorization?: string): Promise<TextureAccessPrincipal> {
    const accessToken = this.parseBearerToken(authorization);
    if (!accessToken)
      throw this.createError(
        { info: "missing bearer token" },
        "texture access",
        "Missing Authorization header with Bearer token.",
        "ForbiddenOperationException",
        HttpStatus.UNAUTHORIZED,
      );

    const entry = await this.tokenStore.findToken(accessToken);
    if (entry) {
      await this.findActiveUserByUsername(entry.username);
      return { kind: "token", entry };
    }

    const payload = await this.verifyAccessJwt(accessToken, HttpStatus.UNAUTHORIZED);
    return { kind: "jwt", payload };
  }

  private assertTextureOwnership(
    principal: TextureAccessPrincipal,
    profile: YggdrasilProfile,
  ): void {
    const owns =
      principal.kind === "token"
        ? principal.entry.profileId === profile.uuid
        : principal.payload.sub === profile.userId;
    if (!owns)
      throw this.createError(
        { info: profile.uuid },
        "texture access denied",
        "Access token does not belong to this profile.",
      );
  }

  private parseBearerToken(authorization?: string): string | null {
    if (!authorization) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    return match?.[1] ?? null;
  }

  private createTextures(
    textureType: "skin" | "cape",
    model: string | null = null,
    url: string | null = null,
  ): YggdrasilTextures {
    const textures: YggdrasilTextures = {};
    if (textureType === "skin") {
      textures.skinUrl = url;
      textures.skinModel = model;
    } else {
      textures.capeUrl = url;
    }
    return textures;
  }

  getMetadata(): ApiMetadataResponseDto {
    return {
      meta: {
        serverName: "Limacina",
        implementationName: "limacina-core",
        implementationVersion: "1.0.0",
        links: {
          homepage: this.config.BASE_URL,
        },
        "feature.non_email_login": true,
      },
      skinDomains: this.resolveSkinDomains(),
      signaturePublickey: this.publicKeyPem,
    };
  }

  private resolveSkinDomains(): string[] {
    const skinDomains: string[] = [];
    try {
      const host = new URL(this.config.BASE_URL).hostname;
      skinDomains.push(host);
      const wildcardDomain = resolveSkinWildcardDomain(host);
      if (wildcardDomain) skinDomains.push(wildcardDomain);
    } catch (error) {
      this.logger.warn(
        { err: error, baseUrl: this.config.BASE_URL },
        "Не удалось вычислить skinDomains из BASE_URL",
      );
    }
    return skinDomains;
  }

  private async prepareAuthResponse(
    userId: string,
    profiles: YggdrasilProfile[],
    clientToken: string | undefined,
    requestUser: boolean | undefined,
    selectedProfileId?: string,
  ): Promise<PreparedAuthResponse> {
    const accessToken = this.generateAccessToken();
    const resolvedClientToken = clientToken ?? this.generateAccessToken();
    const gameProfiles = await Promise.all(profiles.map((p) => this.buildGameProfile(p)));
    const selected = selectedProfileId
      ? profiles.find((p) => p.uuid === selectedProfileId)
      : profiles.length === 1
        ? profiles[0]
        : undefined;
    const selectedProfile = selected ? await this.buildGameProfile(selected) : undefined;

    const response: AuthenticateResponseDto = {
      accessToken,
      clientToken: resolvedClientToken,
      availableProfiles: gameProfiles,
    };
    if (selectedProfile) response.selectedProfile = selectedProfile;
    if (requestUser) {
      response.user = {
        id: userId,
        properties: [],
      };
    }

    return { accessToken, clientToken: resolvedClientToken, selected, response };
  }

  private async buildGameProfile(profile: YggdrasilProfile): Promise<GameProfileDto> {
    return {
      id: profile.uuid,
      name: profile.username,
      properties: await this.buildTextureProperties(profile),
    };
  }

  private async buildTextureProperties(
    profile: YggdrasilProfile,
    signed = true,
  ): Promise<TextureProperty[]> {
    const properties: TextureProperty[] = [];

    let skinModel = profile.skinModel ?? null;
    let skinUrl = profile.skinUrl ?? null;
    let capeUrl = profile.capeUrl ?? null;
    if (!skinUrl) {
      const userSkins = await this.contentStore.findByUserUuid(profile.userId, "skin");
      const activeSkin = userSkins.find((skin) => skin.active);
      if (activeSkin) {
        skinUrl = activeSkin.filePath;
        const { skinModel: activeModel } = activeSkin;
        if (activeModel) skinModel = activeModel;
      }
    }
    if (!skinUrl) skinUrl = this.defaultSkinUrl;

    if (!capeUrl) {
      const userCapes = await this.contentStore.findByUserUuid(profile.userId, "cape");
      const latestCape = lastById(userCapes);
      if (latestCape) capeUrl = latestCape.filePath;
    }

    const texturesProfile: YggdrasilProfile = { ...profile, skinUrl, skinModel, capeUrl };
    const texturesValue = this.encodeTextures(profile.uuid, profile.username, texturesProfile);

    const property: TextureProperty = {
      name: "textures",
      value: texturesValue,
    };

    if (this.privateKey && signed) {
      const sig = sign("sha1", new Uint8Array(Buffer.from(texturesValue)), this.privateKey);
      property.signature = sig.toString("base64");
    }

    properties.push(property);
    properties.push(buildUploadableTexturesProperty());
    return properties;
  }

  private encodeTextures(
    profileId: string,
    profileName: string,
    profile: YggdrasilProfile,
  ): string {
    const textures: Record<string, { url: string; metadata?: Record<string, string> }> = {};

    if (profile.skinUrl) {
      const entry: { url: string; metadata?: Record<string, string> } = { url: profile.skinUrl };
      if (profile.skinModel) {
        entry.metadata = { model: profile.skinModel };
      }
      textures["SKIN"] = entry;
    }
    if (profile.capeUrl) {
      textures["CAPE"] = { url: profile.capeUrl };
    }

    const payload = {
      timestamp: Date.now(),
      profileId,
      profileName,
      textures,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  private generateAccessToken(): string {
    return generateUuid();
  }
}
