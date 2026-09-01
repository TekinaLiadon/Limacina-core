import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sign, createHmac } from "node:crypto";
import type {
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
import type {
  IYggdrasilStore,
  IYggdrasilTokenStore,
  IYggdrasilSessionStore,
  YggdrasilProfile,
} from "./yggdrasil_store";
import {
  YggdrasilStoreToken,
  YggdrasilTokenStoreToken,
  YggdrasilSessionStoreToken,
} from "./yggdrasil_store";
import type { IUserContentStore } from "../../user-content/user-content.store";
import { UserContentMapStoreToken } from "../../user-content/user-content.store";
import { AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";

export function resolveKeysDir(): string {
  const envKeysDir = process.env["KEYS_DIR"];
  if (envKeysDir) return resolve(envKeysDir);

  if (import.meta.dir.startsWith("/$bunfs")) return join(process.cwd(), "keys");

  return join(import.meta.dir, "..", "..", "..", "keys");
}

const KEYS_DIR = resolveKeysDir();
const privateKeyPath = join(KEYS_DIR, "private.pem");
const publicKeyPath = join(KEYS_DIR, "public.pem");

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_TEXTURE_BYTES = 512 * 1024;

let privateKey = "";
let publicKeyPem = "";

if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
  privateKey = readFileSync(privateKeyPath, "utf-8");
  publicKeyPem = readFileSync(publicKeyPath, "utf-8");
}

type Textures = {
  skinUrl?: string | null;
  skinModel?: string | null;
  capeUrl?: string | null;
}; // TODO
@Injectable()
export class YggdrasilService {
  private readonly logger = new Logger(YggdrasilService.name);
  private readonly defaultSkinUrl: string;
  private readonly jwtSecret: string;

  constructor(
    @Inject(YggdrasilStoreToken) private readonly store: IYggdrasilStore,
    @Inject(YggdrasilTokenStoreToken) private readonly tokenStore: IYggdrasilTokenStore,
    @Inject(YggdrasilSessionStoreToken) private readonly sessionStore: IYggdrasilSessionStore,
    @Inject(UserContentMapStoreToken) private readonly contentStore: IUserContentStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
  ) {
    this.defaultSkinUrl = `${config.BASE_URL}/textures/default.png`;
    this.jwtSecret = config.JWT_ACCESS;

    if (!publicKeyPem || !privateKey) {
      this.logger.error(
        { keysDir: KEYS_DIR },
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
    if (this.store.authenticateViaProxy) return this.authenticateViaProxy(dto);

    const user = await this.store.findUserByUsername(dto.username);
    if (!user)
      throw this.createError(
        { info: dto.username },
        "user not found",
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

  private async authenticateViaProxy(dto: AuthenticateDto): Promise<AuthenticateResponseDto> {
    const result = await this.store.authenticateViaProxy!(
      dto.username,
      dto.password,
      dto.clientToken,
    );

    if (!result)
      throw this.createError(
        { info: dto.username },
        "user not found",
        "Invalid credentials. Invalid username or password.",
      );

    for (const profile of result.profiles) {
      await this.store.saveProfile(profile);
    }

    const resolvedClientToken = dto.clientToken ?? result.clientToken;
    const selected = result.selectedProfile;
    const availableProfiles = await Promise.all(
      result.profiles.map((p) => this.buildGameProfile(p)),
    );

    this.tokenStore.saveToken(result.accessToken, {
      profileId: selected?.uuid ?? null,
      username: selected?.username ?? result.profiles[0]?.username ?? "",
      clientToken: resolvedClientToken,
      userId: result!.userId ?? selected?.userId ?? "",
    });
    const response: AuthenticateResponseDto = {
      accessToken: result.accessToken,
      clientToken: resolvedClientToken,
      availableProfiles,
    };

    if (selected) response.selectedProfile = await this.buildGameProfile(selected);
    if (dto.requestUser) {
      response.user = {
        id: result.userId ?? selected?.userId ?? "",
        properties: [],
      };
    }
    this.logger.debug({ username: dto.username }, "authenticated via proxy");
    return response;
  }

  async refresh(dto: RefreshDto): Promise<RefreshResponseDto> {
    if (this.store.refreshViaProxy) return this.refreshViaProxy(dto);

    const entry = await this.tokenStore.findToken(dto.accessToken);
    if (!entry || (dto.clientToken && dto.clientToken !== entry.clientToken))
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    await this.tokenStore.deleteToken(dto.accessToken);
    let selectedProfile: string | undefined = entry.profileId ?? undefined;
    if (dto.selectedProfile) {
      if (entry.profileId)
        throw this.createError(
          { info: "***" },
          "invalid token",
          "Access token already has a profile assigned.",
          "IllegalArgumentException",
          HttpStatus.BAD_REQUEST,
        );
      selectedProfile = dto.selectedProfile.id;
    }

    const profiles = await this.store.findProfilesByUserId(entry.userId);
    const user = await this.store.findUserByUsername(entry.username);
    if (!user) throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    const response = await this.createAuthResponse(
      user.uuid,
      profiles,
      dto.clientToken ?? entry.clientToken,
      dto.requestUser,
      selectedProfile,
    );
    return response;
  }

  private async refreshViaProxy(dto: RefreshDto): Promise<RefreshResponseDto> {
    const result = await this.store.refreshViaProxy!(
      dto.accessToken,
      dto.clientToken,
      dto.selectedProfile?.id,
      dto.requestUser,
    );

    if (!result) throw this.createError({ info: "***" }, "invalid token", "Invalid token.");
    if (result.selectedProfile) await this.store.saveProfile(result.selectedProfile);

    await this.tokenStore.deleteToken(dto.accessToken);
    const resolvedClientToken = dto.clientToken ?? result.clientToken;
    const selected = result.selectedProfile;
    this.tokenStore.saveToken(result.accessToken, {
      profileId: selected?.uuid ?? null,
      username: selected?.username ?? "",
      clientToken: resolvedClientToken,
      userId: result.userId ?? selected?.userId ?? "",
    });
    const response: RefreshResponseDto = {
      accessToken: result.accessToken,
      clientToken: resolvedClientToken,
    };

    if (selected) response.selectedProfile = await this.buildGameProfile(selected);
    if (dto.requestUser) {
      response.user = {
        id: result.userId ?? selected?.userId ?? "",
        properties: [],
      };
    }
    return response;
  }

  async validate(dto: ValidateDto): Promise<void> {
    const entry = await this.tokenStore.findToken(dto.accessToken);
    if (!entry || (dto.clientToken && dto.clientToken !== entry?.clientToken))
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");
  }

  async invalidate(dto: InvalidateDto): Promise<void> {
    await this.tokenStore.deleteToken(dto.accessToken);
  }

  async signout(dto: SignoutDto): Promise<void> {
    if (this.store.signoutViaProxy) return this.signoutViaProxy(dto);

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

  private async signoutViaProxy(dto: SignoutDto): Promise<void> {
    const ok = await this.store.signoutViaProxy!(dto.username, dto.password);
    if (!ok)
      throw this.createError(
        { info: dto.username },
        "invalid credentials",
        "Invalid credentials. Invalid username or password.",
      );
  }

  async join(dto: JoinDto): Promise<void> {
    const entry = await this.tokenStore.findToken(dto.accessToken);

    if (!entry) {
      const jwtPayload = this.verifyJwt(dto.accessToken);
      if (!jwtPayload) {
        throw this.createError({ info: "***" }, "invalid token", "Invalid token.");
      }

      await this.sessionStore.saveSession(dto.serverId, {
        profileId: dto.selectedProfile,
        username: jwtPayload.username,
        ip: "",
      });
      return;
    }

    if (entry.profileId !== dto.selectedProfile)
      throw this.createError({ info: "***" }, "invalid token", "Invalid token.");

    await this.sessionStore.saveSession(dto.serverId, {
      profileId: dto.selectedProfile,
      username: entry.username,
      ip: "",
    });
  }

  private verifyJwt(token: string): { sub: string; username: string } | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const headerB64 = parts[0];
      const payloadB64 = parts[1];
      const sigB64 = parts[2];
      if (!headerB64 || !payloadB64 || !sigB64) return null;
      const expectedSig = createHmac("sha256", this.jwtSecret)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");

      if (sigB64 !== expectedSig) return null;

      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
        sub: string;
        username: string;
        exp: number;
      };

      if (payload.exp * 1000 < Date.now()) return null;

      return { sub: payload.sub, username: payload.username };
    } catch {
      return null;
    }
  }

  async hasJoined(
    username: string,
    serverId: string,
    ip?: string,
  ): Promise<SessionProfileDto | null> {
    const session = await this.sessionStore.findSession(serverId);
    if (!session) return null;

    const profile = await this.store.findProfileByUuid(session.profileId);
    if (!profile || profile.username !== username) return null;

    if (ip && session.ip && session.ip !== ip) return null;
    return {
      id: profile.uuid,
      name: profile.username,
      properties: await this.buildTextureProperties(profile),
    };
  }

  async getProfile(uuid: string): Promise<SessionProfileDto | null> {
    const normalized = uuid.replace(/-/g, "");
    const profile = await this.store.findProfileByUuid(normalized);
    if (!profile) return null;

    return {
      id: profile.uuid,
      name: profile.username,
      properties: await this.buildTextureProperties(profile),
    };
  }

  async batchProfiles(names: string[]): Promise<GameProfileDto[]> {
    const maxProfiles = 10;
    const limited = names.slice(0, maxProfiles);
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
    const normalizedUuid = uuid.replace(/-/g, "");
    const profile = await this.store.findProfileByUuid(normalizedUuid);
    if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

    await this.assertTextureOwnership(profile, authorization);
    this.validateTextureFile(file);

    const url = await this.writeTexture(file);

    const textures: Textures = this.createTextures(textureType, model ?? null, url);
    await this.store.updateProfileTexture(normalizedUuid, textures);
  }

  private validateTextureFile(file: Buffer): void {
    if (file.length > MAX_TEXTURE_BYTES) {
      throw this.createError(
        { info: `size ${file.length} bytes, max ${MAX_TEXTURE_BYTES}` },
        "texture upload",
        `Texture file too large: ${file.length} bytes (max ${MAX_TEXTURE_BYTES}).`,
      );
    }

    const hasPngSignature =
      file.length >= PNG_SIGNATURE.length &&
      PNG_SIGNATURE.every((byte, index) => file[index] === byte);
    if (!hasPngSignature) {
      throw this.createError(
        { info: "no png signature" },
        "texture upload",
        "Invalid texture file: PNG signature missing.",
      );
    }
  }

  async writeTexture(file: Buffer): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(file));
    const hash = hasher.digest("hex");
    const filename = `${hash}.png`;
    const url = `${this.config.BASE_URL}/textures/${filename}`;
    await Bun.write(`public/textures/${filename}`, new Uint8Array(file));
    return url;
  }

  async deleteTexture(
    uuid: string,
    textureType: "skin" | "cape",
    authorization?: string,
  ): Promise<void> {
    const normalizedUuid = uuid.replace(/-/g, "");
    const profile = await this.store.findProfileByUuid(normalizedUuid);
    if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

    await this.assertTextureOwnership(profile, authorization);

    const textures: Textures = this.createTextures(textureType);
    await this.store.updateProfileTexture(normalizedUuid, textures);
  }

  private async assertTextureOwnership(
    profile: YggdrasilProfile,
    authorization?: string,
  ): Promise<void> {
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
      if (entry.profileId !== profile.uuid)
        throw this.createError(
          { info: profile.uuid },
          "texture access denied",
          "Access token does not belong to this profile.",
        );
      return;
    }

    const jwtPayload = this.verifyJwt(accessToken);
    if (!jwtPayload)
      throw this.createError(
        { info: "***" },
        "invalid token",
        "Invalid token.",
        "ForbiddenOperationException",
        HttpStatus.UNAUTHORIZED,
      );

    if (jwtPayload.sub !== profile.userId)
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
  ): Textures {
    const textures: {
      skinUrl?: string | null;
      skinModel?: string | null;
      capeUrl?: string | null;
    } = {};
    if (textureType === "skin") {
      textures.skinUrl = url;
      textures.skinModel = model;
    } else {
      textures.capeUrl = url;
    }
    return textures;
  }

  getMetadata() {
    const skinDomains: string[] = [];
    try {
      const url = new URL(this.config.BASE_URL);
      const host = url.hostname;
      skinDomains.push(host);
      if (host.includes(".")) {
        const dotIndex = host.indexOf(".");
        skinDomains.push(host.slice(dotIndex));
      }
    } catch {}

    return {
      meta: {
        serverName: "Limacina",
        implementationName: "limacina-core",
        implementationVersion: "1.0.0",
        links: {
          homepage: "https://limacina.example.com",
        },
        "feature.non_email_login": true,
      },
      skinDomains,
      signaturePublickey: publicKeyPem,
    };
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

    this.tokenStore.saveToken(accessToken, {
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
  ): Promise<Array<{ name: string; value: string; signature?: string }>> {
    const properties: Array<{ name: string; value: string; signature?: string }> = [];

    let skinUrl = profile.skinUrl;
    if (!skinUrl) {
      const userSkins = await this.contentStore.findByUserUuid(profile.userId, "skin");
      const latestSkin = userSkins.toSorted((a, b) => a.id - b.id).at(-1);
      if (latestSkin) skinUrl = latestSkin.filePath;
    }
    if (!skinUrl) skinUrl = this.defaultSkinUrl;

    const texturesProfile: YggdrasilProfile = { ...profile, skinUrl };
    const texturesValue = this.encodeTextures(profile.uuid, profile.username, texturesProfile);

    const property: { name: string; value: string; signature?: string } = {
      name: "textures",
      value: texturesValue,
    };

    if (privateKey) {
      const sig = sign("sha1", new Uint8Array(Buffer.from(texturesValue)), privateKey);
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
