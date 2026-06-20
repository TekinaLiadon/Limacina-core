import { Injectable, Logger } from "@nestjs/common";
import type {
  IYggdrasilStore,
  YggdrasilProfile,
  ProxyAuthResult,
  ProxyRefreshResult,
} from "./yggdrasil_store";
import { limaFetch } from "../../utils/fetch";

interface UpstreamProfile {
  id: string;
  name: string;
  properties: Array<{ name: string; value: string; signature?: string }>;
}

interface UpstreamAuthResponse {
  accessToken: string;
  clientToken: string;
  availableProfiles: UpstreamProfile[];
  selectedProfile?: UpstreamProfile;
  user?: { id: string; properties: unknown[] };
}

@Injectable()
export class YggdrasilProxyStore implements IYggdrasilStore {
  private readonly logger = new Logger(YggdrasilProxyStore.name);
  private readonly upstreamUrl: string;

  private readonly profiles = new Map<string, YggdrasilProfile>();

  constructor(upstreamUrl: string) {
    this.upstreamUrl = upstreamUrl.replace(/\/+$/, "");
  }

  async authenticateViaProxy(
    username: string,
    password: string,
    clientToken?: string,
  ): Promise<ProxyAuthResult | null> {
    const res = await limaFetch<UpstreamAuthResponse>(
      `${this.upstreamUrl}/authserver/authenticate`,
      {
        method: "POST",
        body: { username, password, clientToken, requestUser: true },
      },
    );

    if (!res.ok || !res.data) {
      this.logger.warn(
        { username, status: res.status, error: res.error },
        "upstream authenticate failed",
      );
      return null;
    }

    const upstream = res.data;
    const profiles = upstream.availableProfiles.map((p) => this.mapUpstreamProfile(p));
    const selectedProfile = upstream.selectedProfile
      ? this.mapUpstreamProfile(upstream.selectedProfile)
      : undefined;

    return {
      accessToken: upstream.accessToken,
      clientToken: upstream.clientToken,
      profiles,
      ...(selectedProfile ? { selectedProfile } : {}),
      ...(upstream.user?.id ? { userId: upstream.user.id } : {}),
    };
  }

  async refreshViaProxy(
    accessToken: string,
    clientToken?: string,
    _selectedProfile?: string,
    requestUser?: boolean,
  ): Promise<ProxyRefreshResult | null> {
    const body: Record<string, unknown> = { accessToken, requestUser: requestUser ?? true };
    if (clientToken) body["clientToken"] = clientToken;

    const res = await limaFetch<UpstreamAuthResponse>(`${this.upstreamUrl}/authserver/refresh`, {
      method: "POST",
      body,
    });

    if (!res.ok || !res.data) {
      this.logger.warn({ status: res.status, error: res.error }, "upstream refresh failed");
      return null;
    }

    const upstream = res.data;
    const selectedProfile = upstream.selectedProfile
      ? this.mapUpstreamProfile(upstream.selectedProfile)
      : undefined;

    return {
      accessToken: upstream.accessToken,
      clientToken: upstream.clientToken,
      ...(selectedProfile ? { selectedProfile } : {}),
      ...(upstream.user?.id ? { userId: upstream.user.id } : {}),
    };
  }

  async signoutViaProxy(username: string, password: string): Promise<boolean> {
    const res = await limaFetch(`${this.upstreamUrl}/authserver/invalidate`, {
      method: "POST",
      body: { username, password },
    });

    return res.ok;
  }

  async findProfileByUuid(uuid: string): Promise<YggdrasilProfile | undefined> {
    const cached = this.profiles.get(uuid);
    if (cached) return cached;

    const res = await limaFetch<UpstreamProfile>(
      `${this.upstreamUrl}/sessionserver/session/minecraft/profile/${uuid}`,
    );
    if (!res.ok || !res.data) return undefined;

    const profile = this.mapUpstreamProfile(res.data);
    this.profiles.set(profile.uuid, profile);
    return profile;
  }

  async findProfileByUsername(username: string): Promise<YggdrasilProfile | undefined> {
    for (const profile of this.profiles.values()) {
      if (profile.username === username) return profile;
    }

    const res = await limaFetch<UpstreamProfile[]>(`${this.upstreamUrl}/api/profiles/minecraft`, {
      method: "POST",
      body: [username],
    });

    if (!res.ok || !res.data || res.data.length === 0) return undefined;

    const profile = this.mapUpstreamProfile(res.data[0]!);
    this.profiles.set(profile.uuid, profile);
    return profile;
  }

  async findProfilesByUserId(userId: string): Promise<YggdrasilProfile[]> {
    return Array.from(this.profiles.values()).filter((p) => p.userId === userId);
  }

  async findProfilesByUsernames(usernames: string[]): Promise<YggdrasilProfile[]> {
    const result: YggdrasilProfile[] = [];
    for (const name of usernames) {
      const profile = await this.findProfileByUsername(name);
      if (profile) result.push(profile);
    }
    return result;
  }

  async saveProfile(profile: YggdrasilProfile): Promise<void> {
    this.profiles.set(profile.uuid, profile);
  }

  async updateProfileTexture(
    uuid: string,
    textures: { skinUrl?: string | null; skinModel?: string | null; capeUrl?: string | null },
  ): Promise<void> {
    const profile = this.profiles.get(uuid);
    if (!profile) return;
    this.profiles.set(uuid, { ...profile, ...textures });
  }

  async findUserByUsername(
    _username: string,
  ): Promise<{ uuid: string; passwordHash: string } | undefined> {
    return undefined;
  }

  private mapUpstreamProfile(upstream: UpstreamProfile): YggdrasilProfile {
    let skinUrl: string | null = null;
    let skinModel: string | null = null;
    let capeUrl: string | null = null;

    for (const prop of upstream.properties) {
      if (prop.name === "textures") {
        try {
          const decoded = JSON.parse(Buffer.from(prop.value, "base64").toString()) as {
            textures?: Record<string, { url: string; metadata?: Record<string, string> }>;
          };
          if (decoded.textures?.["SKIN"]) {
            skinUrl = decoded.textures["SKIN"].url;
            skinModel = decoded.textures["SKIN"].metadata?.["model"] ?? null;
          }
          if (decoded.textures?.["CAPE"]) {
            capeUrl = decoded.textures["CAPE"].url;
          }
        } catch {
          this.logger.warn({ profileId: upstream.id }, "failed to decode upstream textures");
        }
      }
    }

    return {
      uuid: upstream.id,
      userId: upstream.id,
      username: upstream.name,
      skinUrl,
      skinModel,
      capeUrl,
    };
  }
}
