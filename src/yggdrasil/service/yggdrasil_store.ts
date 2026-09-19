import { Injectable, Optional } from "@nestjs/common";
import { MemoryDb, type MemoryUserRecord } from "../../memory/memory-db";

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
}

export interface YggdrasilUserCredentials {
  uuid: string;
  passwordHash: string;
  banned: boolean;
  approved: boolean;
  passwordChangedAt?: Date | undefined;
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
  passwordChangedAt?: Date | undefined;
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
  claimToken(accessToken: string): Promise<TokenEntry | undefined>;
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
  private readonly db: MemoryDb;
  private readonly profilesByUuid = new Map<string, YggdrasilProfile>();
  private readonly profilesByUsername = new Map<string, string>();
  private readonly profilesByUserId = new Map<string, string[]>();

  constructor(
    @Optional() db: MemoryDb = new MemoryDb(),
    seed: { users?: YggdrasilSeedUser[]; profiles?: YggdrasilProfile[] } = {},
  ) {
    this.db = db;
    for (const user of seed.users ?? []) {
      this.db.users.set(user.uuid, {
        uuid: user.uuid,
        username: user.username,
        passwordHash: user.passwordHash,
        role: "user",
        approved: user.approved ?? true,
        banned: user.banned ?? false,
        deleted: false,
        deletedAt: null,
        passwordChangedAt: user.passwordChangedAt,
      });
    }
    for (const profile of seed.profiles ?? []) {
      this.indexProfile(profile);
    }
  }

  async findProfileByUuid(uuid: string): Promise<YggdrasilProfile | undefined> {
    const indexed = this.visibleProfile(this.profilesByUuid.get(uuid));
    if (indexed) return indexed;
    return this.derivedProfile(uuid);
  }

  async findProfileByUsername(username: string): Promise<YggdrasilProfile | undefined> {
    const uuid = this.profilesByUsername.get(username);
    if (uuid) {
      const indexed = this.visibleProfile(this.profilesByUuid.get(uuid));
      if (indexed) return indexed;
    }
    const user = this.liveUser(username);
    if (!user) return undefined;
    return this.derivedProfile(user.uuid);
  }

  async findProfilesByUserId(userId: string): Promise<YggdrasilProfile[]> {
    const uuids = this.profilesByUserId.get(userId) ?? [];
    const indexed = uuids
      .map((uuid) => this.visibleProfile(this.profilesByUuid.get(uuid)))
      .filter((p): p is YggdrasilProfile => p !== undefined);
    if (indexed.length > 0) return indexed;

    const user = this.db.users.get(userId);
    if (!user || user.deleted) return [];
    const derived = this.derivedProfile(user.uuid);
    return derived ? [derived] : [];
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
    const indexed = this.profilesByUuid.get(uuid);
    if (indexed) {
      const updated = { ...indexed, ...textures };
      this.profilesByUuid.set(uuid, updated);
      if (this.profilesByUsername.has(updated.username)) {
        this.profilesByUsername.set(updated.username, uuid);
      }
      return;
    }

    const user = this.db.users.get(uuid);
    if (!user || user.deleted) return;
    this.indexProfile({ uuid: user.uuid, userId: user.uuid, username: user.username, ...textures });
  }

  async countProfilesByTextureUrl(url: string): Promise<number> {
    let count = 0;
    for (const profile of this.profilesByUuid.values()) {
      if (profile.skinUrl === url || profile.capeUrl === url) count++;
    }
    return count;
  }

  async findUserByUsername(username: string): Promise<YggdrasilUserCredentials | undefined> {
    const user = this.liveUser(username);
    if (!user) return undefined;
    return {
      uuid: user.uuid,
      passwordHash: user.passwordHash,
      banned: user.banned,
      approved: user.approved,
      passwordChangedAt: user.passwordChangedAt,
    };
  }

  private liveUser(username: string): MemoryUserRecord | undefined {
    for (const user of this.db.users.values()) {
      if (user.username === username && !user.deleted) return user;
    }
    return undefined;
  }

  private visibleProfile(profile: YggdrasilProfile | undefined): YggdrasilProfile | undefined {
    if (!profile) return undefined;
    const owner = this.db.users.get(profile.userId);
    if (!owner || !owner.deleted) return profile;
    return undefined;
  }

  private derivedProfile(uuid: string): YggdrasilProfile | undefined {
    const user = this.db.users.get(uuid);
    if (!user || user.deleted) return undefined;
    return { uuid: user.uuid, userId: user.uuid, username: user.username };
  }
}
