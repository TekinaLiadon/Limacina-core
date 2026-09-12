import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sign } from "node:crypto";
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
import type { JwtAccessPayload } from "../../common/jwt.strategy";
import { MAX_PROFILE_NAMES } from "../batch-profiles.pipe";
import {
  UserContentMapStoreToken,
  type IUserContentStore,
} from "../../user-content/user-content.store";
import { AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import { resolveKeysDir } from "./keys-dir";
import { sanitizeFilePrefix } from "../../utils/file-prefix";
import { PngStructureError, validatePngStructure } from "../../utils/png";

const MAX_TEXTURE_BYTES = 512 * 1024;
const SKIN_MODEL_VALUES = ["classic", "slim"] as const;

type TextureAccessPrincipal =
  | { kind: "token"; entry: TokenEntry }
  | { kind: "jwt"; payload: JwtAccessPayload };

@Injectable()
export class YggdrasilService {
  private readonly logger = new Logger(YggdrasilService.name);
  private readonly defaultSkinUrl: string;
  private readonly jwtSecret: string;
  private readonly privateKey: string;
  private readonly publicKeyPem: string;

  constructor(
    @Inject(YggdrasilStoreToken) private readonly store: IYggdrasilStore,
    @Inject(YggdrasilTokenStoreToken) private readonly tokenStore: IYggdrasilTokenStore,
    @Inject(YggdrasilSessionStoreToken) private readonly sessionStore: IYggdrasilSessionStore,
    @Inject(UserContentMapStoreToken) private readonly contentStore: IUserContentStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
    private readonly jwtService: JwtService,
  ) {
    this.defaultSkinUrl = `${config.BASE_URL}/textures/default.png`;
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

  createError(
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

  async authenticate(dto: AuthenticateDto): Promise<AuthenticateResponseDto> {
    const user = await this.store.findUserByUsername(dto.username);
    if (!user)
      throw this.createError(
        { info: dto.username },
        "user not found",
        "Invalid credentials. Invalid username or password.",
      );

    if (user.banned || !user.approved)
      throw this.createError(
        { info: dto.username },
        "user banned or not approved",
        "Invalid credentials. Invalid username or password.",
      );

    const valid = await Bun.password.verify(dto.password, user.passwordHash);
    if (!valid)
      throw this.createError(
        { info: dto.username },
        "invalid password",
        "Invalid credentials. Invalid username or password.",
      );

    const profiles = await this.store.findProfilesByUserId(user.uuid);
    if (profiles.length === 0)
      throw this.createError(
        { info: dto.username },
        "no profiles",
        "Invalid credentials. Invalid username or password.",
      );

    return await this.createAuthResponse(user!.uuid, profiles, dto.clientToken, dto.requestUser);
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

    const claimed = await this.tokenStore.claimToken(dto.accessToken);
    if (!claimed) throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    return await this.createAuthResponse(
      user.uuid,
      profiles,
      dto.clientToken ?? entry.clientToken,
      dto.requestUser,
      selectedProfile,
    );
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
    if (!user)
      throw this.createError(
        { info: dto.username },
        "invalid credentials",
        "Invalid credentials. Invalid username or password.",
      );

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
      const jwtPayload = await this.verifyAccessToken(dto.accessToken);
      if (!jwtPayload) {
        throw this.createError({ info: "***" }, "invalid token", "Invalid token.");
      }

      await this.findActiveUserByUsername(jwtPayload.username);
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

  async getProfile(uuid: string, signed = true): Promise<SessionProfileDto | null> {
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
    const profile = await this.store.findProfileByUuid(normalizedUuid);
    if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

    this.assertTextureOwnership(principal, profile);
    this.validateTextureFile(file);
    const skinModel = this.normalizeSkinModel(model);

    const previousUrl = textureType === "skin" ? profile.skinUrl : profile.capeUrl;
    const url = await this.writeTexture(file, profile.username, normalizedUuid);

    const textures: YggdrasilTextures = this.createTextures(textureType, skinModel, url);
    await this.store.updateProfileTexture(normalizedUuid, textures);
    await this.releaseTextureFile(previousUrl, textureType);
  }

  private normalizeSkinModel(model?: string): string | null {
    if (model === undefined || model === null || model === "") return null;
    if (SKIN_MODEL_VALUES.includes(model as (typeof SKIN_MODEL_VALUES)[number])) return model;
    throw this.createError(
      { info: model },
      "invalid model",
      "Invalid model. Supported values: classic, slim.",
      "IllegalArgumentException",
      HttpStatus.BAD_REQUEST,
    );
  }

  private validateTextureFile(file: Buffer): void {
    if (file.length > MAX_TEXTURE_BYTES) {
      throw this.createError(
        { info: `size ${file.length} bytes, max ${MAX_TEXTURE_BYTES}` },
        "texture upload",
        `Texture file too large: ${file.length} bytes (max ${MAX_TEXTURE_BYTES}).`,
      );
    }

    try {
      validatePngStructure(file);
    } catch (error) {
      if (!(error instanceof PngStructureError)) throw error;
      throw this.createError(
        { info: error.message },
        "texture upload",
        `Invalid texture file: ${error.message}.`,
      );
    }
  }

  async writeTexture(file: Buffer, ownerUsername: string, fallbackPrefix: string): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(file));
    const hash = hasher.digest("hex");
    const prefix = sanitizeFilePrefix(ownerUsername, fallbackPrefix);
    const filename = `${prefix}-${hash}.png`;
    const url = `${this.config.BASE_URL}/textures/${filename}`;
    await Bun.write(`public/textures/${filename}`, new Uint8Array(file));
    return url;
  }

  async deleteTexture(
    uuid: string,
    textureType: "skin" | "cape",
    authorization?: string,
  ): Promise<void> {
    const principal = await this.authenticateTextureAccess(authorization);
    const normalizedUuid = uuid.replace(/-/g, "");
    const profile = await this.store.findProfileByUuid(normalizedUuid);
    if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

    this.assertTextureOwnership(principal, profile);

    const previousUrl = textureType === "skin" ? profile.skinUrl : profile.capeUrl;
    const textures: YggdrasilTextures = this.createTextures(textureType);
    await this.store.updateProfileTexture(normalizedUuid, textures);
    await this.releaseTextureFile(previousUrl, textureType);
  }

  private async releaseTextureFile(
    url: string | null | undefined,
    textureType: "skin" | "cape",
  ): Promise<void> {
    if (!url) return;
    const localPath = this.resolveOwnTexturePath(url);
    if (!localPath) return;

    const contentRefs = await this.contentStore.countByFilePath(url, textureType);
    const profileRefs = await this.store.countProfilesByTextureUrl(url);
    if (contentRefs + profileRefs > 0) {
      this.logger.debug(
        { url, contentRefs, profileRefs },
        "Файл текстуры ещё используется другими ссылками",
      );
      return;
    }

    try {
      unlinkSync(localPath);
      this.logger.debug({ url }, "Файл текстуры удалён");
    } catch (error) {
      this.logger.error({ err: error, path: localPath }, "Не удалось удалить файл текстуры");
    }
  }

  private resolveOwnTexturePath(url: string): string | undefined {
    if (url === this.defaultSkinUrl) return undefined;
    if (!url.startsWith(`${this.config.BASE_URL}/`)) return undefined;
    const localPath = `public/${url.replace(`${this.config.BASE_URL}/`, "")}`;
    const hosted =
      localPath.startsWith("public/textures/") || localPath.startsWith("public/capes/");
    return hosted ? localPath : undefined;
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
    if (entry) return { kind: "token", entry };

    const payload = await this.verifyAccessToken(accessToken);
    if (!payload)
      throw this.createError(
        { info: "***" },
        "invalid token",
        "Invalid token.",
        "ForbiddenOperationException",
        HttpStatus.UNAUTHORIZED,
      );
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

  createTextures(
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
      if (host.includes(".")) {
        skinDomains.push(host.slice(host.indexOf(".")));
      }
    } catch (error) {
      this.logger.warn(
        { err: error, baseUrl: this.config.BASE_URL },
        "Не удалось вычислить skinDomains из BASE_URL",
      );
    }
    return skinDomains;
  }

  private async createAuthResponse(
    userId: string,
    profiles: YggdrasilProfile[],
    clientToken?: string,
    requestUser?: boolean,
    selectedProfileId?: string,
  ): Promise<AuthenticateResponseDto> {
    const accessToken = this.generateAccessToken();
    const resolvedClientToken = clientToken ?? this.generateAccessToken();
    const gameProfiles = await Promise.all(profiles.map((p) => this.buildGameProfile(p)));
    const selected = selectedProfileId
      ? profiles.find((p) => p.uuid === selectedProfileId)
      : profiles.length === 1
        ? profiles[0]
        : undefined;

    await this.tokenStore.saveToken(accessToken, {
      profileId: selected ? selected.uuid : null,
      username: selected ? selected.username : (profiles[0]?.username ?? ""),
      clientToken: resolvedClientToken,
      userId,
    });
    const response: AuthenticateResponseDto = {
      accessToken,
      clientToken: resolvedClientToken,
      availableProfiles: gameProfiles,
    };

    if (selected) response.selectedProfile = await this.buildGameProfile(selected);
    if (requestUser) {
      response.user = {
        id: userId,
        properties: [],
      };
    }

    this.logger.debug({ userId }, "authenticated");
    return response;
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
  ): Promise<Array<{ name: string; value: string; signature?: string }>> {
    const properties: Array<{ name: string; value: string; signature?: string }> = [];

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
      const latestCape = userCapes.toSorted((a, b) => a.id - b.id).at(-1);
      if (latestCape) capeUrl = latestCape.filePath;
    }

    const texturesProfile: YggdrasilProfile = { ...profile, skinUrl, skinModel, capeUrl };
    const texturesValue = this.encodeTextures(profile.uuid, profile.username, texturesProfile);

    const property: { name: string; value: string; signature?: string } = {
      name: "textures",
      value: texturesValue,
    };

    if (this.privateKey && signed) {
      const sig = sign("sha1", new Uint8Array(Buffer.from(texturesValue)), this.privateKey);
      property.signature = sig.toString("base64");
    }

    properties.push(property);
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
    return crypto.randomUUID().replace(/-/g, "");
  }
}
