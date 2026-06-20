import { Injectable } from "@nestjs/common";

export interface YggdrasilProfile {
  uuid: string;
  userId: string;
  username: string;
  skinUrl?: string | null;
  skinModel?: string | null;
  capeUrl?: string | null;
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

export const YggdrasilStoreToken = Symbol("YggdrasilStore");
export const YggdrasilSessionStoreToken = Symbol("YggdrasilSessionStore");
export const YggdrasilTokenStoreToken = Symbol("YggdrasilTokenStore");

export interface ProxyAuthResult {
  accessToken: string;
  clientToken: string;
  profiles: YggdrasilProfile[];
  selectedProfile?: YggdrasilProfile | null;
  userId?: string;
}

export interface ProxyRefreshResult {
  accessToken: string;
  clientToken: string;
  selectedProfile?: YggdrasilProfile | null;
  userId?: string;
}

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
  updateProfileTexture(
    uuid: string,
    textures: { skinUrl?: string | null; skinModel?: string | null; capeUrl?: string | null },
  ): Promise<void>;

  findUserByUsername(username: string): Promise<{ uuid: string; passwordHash: string } | undefined>;

  authenticateViaProxy?(
    username: string,
    password: string,
    clientToken?: string,
  ): Promise<ProxyAuthResult | null>;

  refreshViaProxy?(
    accessToken: string,
    clientToken?: string,
    selectedProfile?: string,
    requestUser?: boolean,
  ): Promise<ProxyRefreshResult | null>;

  signoutViaProxy?(username: string, password: string): Promise<boolean>;
}

@Injectable()
export class YggdrasilMapStore implements IYggdrasilStore {
  private readonly profilesByUuid = new Map<string, YggdrasilProfile>();
  private readonly profilesByUsername = new Map<string, string>();
  private readonly profilesByUserId = new Map<string, string[]>();
  private readonly users = new Map<string, { uuid: string; passwordHash: string }>();

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
    this.profilesByUuid.set(profile.uuid, profile);
    this.profilesByUsername.set(profile.username, profile.uuid);
    const existing = this.profilesByUserId.get(profile.userId) ?? [];
    if (!existing.includes(profile.uuid)) {
      existing.push(profile.uuid);
      this.profilesByUserId.set(profile.userId, existing);
    }
  }

  async updateProfileTexture(
    uuid: string,
    textures: { skinUrl?: string | null; skinModel?: string | null; capeUrl?: string | null },
  ): Promise<void> {
    const profile = this.profilesByUuid.get(uuid);
    if (!profile) return;
    const updated = { ...profile, ...textures };
    this.profilesByUuid.set(uuid, updated);
    if (this.profilesByUsername.has(updated.username)) {
      this.profilesByUsername.set(updated.username, uuid);
    }
  }

  async findUserByUsername(
    username: string,
  ): Promise<{ uuid: string; passwordHash: string } | undefined> {
    return this.users.get(username);
  }

  async __test__addUser(username: string, uuid: string, passwordHash: string): Promise<void> {
    this.users.set(username, { uuid, passwordHash });
  }
}

@Injectable()
export class YggdrasilMapSessionStore implements IYggdrasilSessionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  async saveSession(serverId: string, entry: SessionEntry): Promise<void> {
    this.sessions.set(serverId, entry);
  }

  async findSession(serverId: string): Promise<SessionEntry | undefined> {
    return this.sessions.get(serverId);
  }
}

@Injectable()
export class YggdrasilMapTokenStore implements IYggdrasilTokenStore {
  private readonly tokens = new Map<string, TokenEntry>();

  async saveToken(accessToken: string, entry: TokenEntry): Promise<void> {
    this.tokens.set(accessToken, entry);
  }

  async findToken(accessToken: string): Promise<TokenEntry | undefined> {
    return this.tokens.get(accessToken);
  }

  async deleteToken(accessToken: string): Promise<void> {
    this.tokens.delete(accessToken);
  }

  async deleteTokensByUserId(userId: string): Promise<void> {
    for (const [key, val] of this.tokens) {
      if (val.userId === userId) this.tokens.delete(key);
    }
  }
}
