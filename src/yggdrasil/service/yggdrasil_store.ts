import { Injectable } from "@nestjs/common";

export interface YggdrasilTextures {
  skinUrl?: string | null;
  skinModel?: string | null;
  capeUrl?: string | null;
}

export interface YggdrasilProfile extends YggdrasilTextures {
  uuid: string;
  userId: string;
  username: string;
}

export interface TokenEntry {
  profileId: string | null;
  username: string;
  clientToken: string;
  userId: string;
}

export interface SessionEntry {
  profileId: string;
  username: string;
  ip: string;
}

export interface YggdrasilUserCredentials {
  uuid: string;
  passwordHash: string;
  banned: boolean;
  approved: boolean;
}

export interface YggdrasilTokenRecord {
  entry: TokenEntry;
  issuedAt: number;
  expiresAt: number;
}

export interface YggdrasilSessionRecord {
  entry: SessionEntry;
  expiresAt: number;
}

export interface YggdrasilSeedUser {
  username: string;
  uuid: string;
  passwordHash: string;
  banned?: boolean | undefined;
  approved?: boolean | undefined;
}

export const TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 1000;
export const MAX_TOKENS_PER_USER = 4;

export const YggdrasilStoreToken = Symbol("YggdrasilStore");
export const YggdrasilSessionStoreToken = Symbol("YggdrasilSessionStore");
export const YggdrasilTokenStoreToken = Symbol("YggdrasilTokenStore");

export interface IYggdrasilSessionStore {
  saveSession(serverId: string, entry: SessionEntry): Promise<void>;
  findSession(serverId: string): Promise<SessionEntry | undefined>;
}

export interface IYggdrasilTokenStore {
  saveToken(accessToken: string, entry: TokenEntry): Promise<void>;
  findToken(accessToken: string): Promise<TokenEntry | undefined>;
  deleteToken(accessToken: string): Promise<void>;
  deleteTokensByUserId(userId: string): Promise<void>;
}

export interface IYggdrasilStore {
  findProfileByUuid(uuid: string): Promise<YggdrasilProfile | undefined>;
  findProfileByUsername(username: string): Promise<YggdrasilProfile | undefined>;
  findProfilesByUserId(userId: string): Promise<YggdrasilProfile[]>;
  findProfilesByUsernames(usernames: string[]): Promise<YggdrasilProfile[]>;
  saveProfile(profile: YggdrasilProfile): Promise<void>;
  updateProfileTexture(uuid: string, textures: YggdrasilTextures): Promise<void>;
  countProfilesByTextureUrl(url: string): Promise<number>;

  findUserByUsername(username: string): Promise<YggdrasilUserCredentials | undefined>;
}

@Injectable()
export class YggdrasilMapStore implements IYggdrasilStore {
  private readonly profilesByUuid = new Map<string, YggdrasilProfile>();
  private readonly profilesByUsername = new Map<string, string>();
  private readonly profilesByUserId = new Map<string, string[]>();
  private readonly users: Map<string, YggdrasilUserCredentials>;

  constructor(seed: { users?: YggdrasilSeedUser[]; profiles?: YggdrasilProfile[] } = {}) {
    this.users = new Map(
      seed.users?.map((user) => [
        user.username,
        {
          uuid: user.uuid,
          passwordHash: user.passwordHash,
          banned: user.banned ?? false,
          approved: user.approved ?? true,
        },
      ]),
    );
    for (const profile of seed.profiles ?? []) {
      this.indexProfile(profile);
    }
  }

  async findProfileByUuid(uuid: string): Promise<YggdrasilProfile | undefined> {
    return this.profilesByUuid.get(uuid);
  }

  async findProfileByUsername(username: string): Promise<YggdrasilProfile | undefined> {
    const uuid = this.profilesByUsername.get(username);
    if (!uuid) return undefined;
    return this.profilesByUuid.get(uuid);
  }

  async findProfilesByUserId(userId: string): Promise<YggdrasilProfile[]> {
    const uuids = this.profilesByUserId.get(userId) ?? [];
    return uuids
      .map((uuid) => this.profilesByUuid.get(uuid))
      .filter((p): p is YggdrasilProfile => p !== undefined);
  }

  async findProfilesByUsernames(usernames: string[]): Promise<YggdrasilProfile[]> {
    const result: YggdrasilProfile[] = [];
    for (const name of usernames) {
      const uuid = this.profilesByUsername.get(name);
      if (uuid) {
        const profile = this.profilesByUuid.get(uuid);
        if (profile) result.push(profile);
      }
    }
    return result;
  }

  async saveProfile(profile: YggdrasilProfile): Promise<void> {
    this.indexProfile(profile);
  }

  private indexProfile(profile: YggdrasilProfile): void {
    this.profilesByUuid.set(profile.uuid, profile);
    this.profilesByUsername.set(profile.username, profile.uuid);
    const existing = this.profilesByUserId.get(profile.userId) ?? [];
    if (!existing.includes(profile.uuid)) {
      existing.push(profile.uuid);
      this.profilesByUserId.set(profile.userId, existing);
    }
  }

  async updateProfileTexture(uuid: string, textures: YggdrasilTextures): Promise<void> {
    const profile = this.profilesByUuid.get(uuid);
    if (!profile) return;
    const updated = { ...profile, ...textures };
    this.profilesByUuid.set(uuid, updated);
    if (this.profilesByUsername.has(updated.username)) {
      this.profilesByUsername.set(updated.username, uuid);
    }
  }

  async countProfilesByTextureUrl(url: string): Promise<number> {
    let count = 0;
    for (const profile of this.profilesByUuid.values()) {
      if (profile.skinUrl === url || profile.capeUrl === url) count++;
    }
    return count;
  }

  async findUserByUsername(username: string): Promise<YggdrasilUserCredentials | undefined> {
    return this.users.get(username);
  }
}
