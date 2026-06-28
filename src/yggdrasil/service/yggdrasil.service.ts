import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { readFileSync, existsSync } from "node:fs";
import { sign } from "node:crypto";
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
import GlobalConfig from "../../config/global-config";

const config = GlobalConfig.parseEnvOrExit();
const DEFAULT_SKIN_URL = `${config.BASE_URL}/textures/default.png`;

const KEYS_DIR = `${import.meta.dir}/../../../keys`;
const privateKeyPath = `${KEYS_DIR}/private.pem`;
const publicKeyPath = `${KEYS_DIR}/public.pem`;

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

  constructor(
    @Inject(YggdrasilStoreToken) private readonly store: IYggdrasilStore,
    @Inject(YggdrasilTokenStoreToken) private readonly tokenStore: IYggdrasilTokenStore,
    @Inject(YggdrasilSessionStoreToken) private readonly sessionStore: IYggdrasilSessionStore,
  ) {}

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

    return this.createAuthResponse(user!.uuid, profiles, dto.clientToken, dto.requestUser);
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
    const availableProfiles = result.profiles.map((p) => this.buildGameProfile(p));

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

    if (selected) response.selectedProfile = this.buildGameProfile(selected);
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
      throw this.createError({ info: dto.accessToken }, "invalid token", "Invalid token.");

    await this.tokenStore.deleteToken(dto.accessToken);
    let selectedProfile: string | undefined = entry.profileId ?? undefined;
    if (dto.selectedProfile) {
      if (entry.profileId)
        throw this.createError(
          { info: entry.profileId },
          "invalid token",
          "Access token already has a profile assigned.",
          "IllegalArgumentException",
          HttpStatus.BAD_REQUEST,
        );
      selectedProfile = dto.selectedProfile.id;
    }

    const profiles = await this.store.findProfilesByUserId(entry.userId);
    const user = await this.store.findUserByUsername(entry.username);
    if (!user) throw this.createError({ info: entry.username }, "invalid token", "Invalid token.");

    const response = this.createAuthResponse(
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

    if (!result)
      throw this.createError({ info: dto.accessToken }, "invalid token", "Invalid token.");
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

    if (selected) response.selectedProfile = this.buildGameProfile(selected);
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
      throw this.createError({ info: dto.accessToken }, "invalid token", "Invalid token.");
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
    if (!entry || entry?.profileId !== dto.selectedProfile)
      throw this.createError({ info: dto.accessToken }, "invalid token", "Invalid token.");

    await this.sessionStore.saveSession(dto.serverId, {
      profileId: dto.selectedProfile,
      username: entry.username,
      ip: "",
    });
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
      properties: this.buildTextureProperties(profile),
    };
  }

  async getProfile(uuid: string): Promise<SessionProfileDto | null> {
    const normalized = uuid.replace(/-/g, "");
    const profile = await this.store.findProfileByUuid(normalized);
    if (!profile) return null;

    return {
      id: profile.uuid,
      name: profile.username,
      properties: this.buildTextureProperties(profile),
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
  ): Promise<void> {
    const profile = await this.store.findProfileByUuid(uuid);
    if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

    const url = await this.writeTexture(file);

    const textures: Textures = this.createTextures(textureType, model ?? null, url);
    await this.store.updateProfileTexture(uuid, textures);
  }

  async writeTexture(file: Buffer): Promise<string> {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(file));
    const hash = hasher.digest("hex");
    const filename = `${hash}.png`;
    const url = `${config.BASE_URL}/textures/${filename}`;
    await Bun.write(`public/textures/${filename}`, new Uint8Array(file));
    return url;
  }

  async deleteTexture(uuid: string, textureType: "skin" | "cape"): Promise<void> {
    const profile = await this.store.findProfileByUuid(uuid);
    if (!profile) throw this.createError({ info: uuid }, "invalid uuid", "Invalid token.");

    const textures: Textures = this.createTextures(textureType);
    await this.store.updateProfileTexture(uuid, textures);
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
      skinDomains: [".limacina.example.com"],
      signaturePublickey: publicKeyPem,
    };
  }

  private createAuthResponse(
    userId: string,
    profiles: YggdrasilProfile[],
    clientToken?: string,
    requestUser?: boolean,
    selectedProfileId?: string,
  ): AuthenticateResponseDto {
    const accessToken = this.generateAccessToken();
    const resolvedClientToken = clientToken ?? this.generateAccessToken();
    const gameProfiles = profiles.map((p) => this.buildGameProfile(p));
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

    if (selected) response.selectedProfile = this.buildGameProfile(selected);
    if (requestUser) {
      response.user = {
        id: userId,
        properties: [],
      };
    }

    this.logger.debug({ userId }, "authenticated");
    return response;
  }

  private buildGameProfile(profile: YggdrasilProfile): GameProfileDto {
    return {
      id: profile.uuid,
      name: profile.username,
      properties: this.buildTextureProperties(profile),
    };
  }

  private buildTextureProperties(
    profile: YggdrasilProfile,
  ): Array<{ name: string; value: string }> {
    const properties: Array<{ name: string; value: string }> = [];
    let texturesValue: string;
    if (profile.skinUrl || profile.capeUrl) {
      texturesValue = this.encodeTextures(profile.uuid, profile.username, profile);
    } else {
      texturesValue = this.encodeTextures(profile.uuid, profile.username, {
        ...profile,
        skinUrl: DEFAULT_SKIN_URL,
      });
    }

    if (privateKey) {
      const sig = sign("sha1", new Uint8Array(Buffer.from(texturesValue)), privateKey);
      texturesValue += ";" + sig.toString("base64");
    }

    properties.push({
      name: "textures",
      value: texturesValue,
    });
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
