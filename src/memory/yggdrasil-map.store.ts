import { Injectable } from "@nestjs/common";
import {
  MAX_TOKENS_PER_USER,
  SESSION_TTL_MS,
  TOKEN_TTL_MS,
  type IYggdrasilSessionStore,
  type IYggdrasilStore,
  type IYggdrasilTokenStore,
  type SessionEntry,
  type TokenEntry,
  type YggdrasilProfile,
  type YggdrasilUserCredentials,
} from "../yggdrasil/service/yggdrasil_store";
import type { MemoryDb } from "./memory-db";

@Injectable()
export class YggdrasilMapStore implements IYggdrasilStore {
  constructor(private readonly db: MemoryDb) {}

  async findProfileByUuid(uuid: string): Promise<YggdrasilProfile | undefined> {
    return this.db.yggdrasilProfiles.get(uuid);
  }

  async findProfileByUsername(username: string): Promise<YggdrasilProfile | undefined> {
    for (const profile of this.db.yggdrasilProfiles.values()) {
      if (profile.username === username) return profile;
    }
    return undefined;
  }

  async findProfilesByUserId(userId: string): Promise<YggdrasilProfile[]> {
    const result: YggdrasilProfile[] = [];
    for (const profile of this.db.yggdrasilProfiles.values()) {
      if (profile.userId === userId) result.push(profile);
    }
    return result;
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
    this.db.yggdrasilProfiles.set(profile.uuid, profile);
  }

  async updateProfileTexture(
    uuid: string,
    textures: { skinUrl?: string | null; skinModel?: string | null; capeUrl?: string | null },
  ): Promise<void> {
    const profile = this.db.yggdrasilProfiles.get(uuid);
    if (!profile) return;
    this.db.yggdrasilProfiles.set(uuid, { ...profile, ...textures });
  }

  async findUserByUsername(username: string): Promise<YggdrasilUserCredentials | undefined> {
    const user = this.db.users.get(username);
    if (!user) return undefined;
    return {
      uuid: user.uuid,
      passwordHash: user.passwordHash,
      banned: user.banned,
      approved: user.approved,
    };
  }

  async findUserStatusByUuid(uuid: string): Promise<{ banned: boolean } | undefined> {
    for (const user of this.db.users.values()) {
      if (user.uuid === uuid) return { banned: user.banned };
    }
    return undefined;
  }

  async __test__addUser(
    username: string,
    uuid: string,
    passwordHash: string,
    flags?: { banned?: boolean; approved?: boolean },
  ): Promise<void> {
    const existing = this.db.users.get(username);
    this.db.users.set(username, {
      uuid,
      username,
      passwordHash,
      role: existing?.role ?? "user",
      approved: flags?.approved ?? existing?.approved ?? true,
      banned: flags?.banned ?? existing?.banned ?? false,
      skin: existing?.skin ?? null,
    });
  }
}

@Injectable()
export class YggdrasilMapTokenStore implements IYggdrasilTokenStore {
  constructor(private readonly db: MemoryDb) {}

  async saveToken(accessToken: string, entry: TokenEntry): Promise<void> {
    this.deleteOldestUserTokens(entry.userId, MAX_TOKENS_PER_USER - 1);
    this.db.yggdrasilTokens.set(accessToken, {
      entry,
      issuedAt: Date.now(),
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
  }

  async findToken(accessToken: string): Promise<TokenEntry | undefined> {
    const record = this.db.yggdrasilTokens.get(accessToken);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.db.yggdrasilTokens.delete(accessToken);
      return undefined;
    }
    return record.entry;
  }

  async deleteToken(accessToken: string): Promise<void> {
    this.db.yggdrasilTokens.delete(accessToken);
  }

  async deleteTokensByUserId(userId: string): Promise<void> {
    for (const [key, record] of this.db.yggdrasilTokens) {
      if (record.entry.userId === userId) this.db.yggdrasilTokens.delete(key);
    }
  }

  private deleteOldestUserTokens(userId: string, keepCount: number): void {
    const userRecords = [...this.db.yggdrasilTokens.entries()]
      .filter(([key]) => this.isLiveUserToken(key, userId))
      .toSorted(([, a], [, b]) => a.issuedAt - b.issuedAt);

    const excess = userRecords.length - keepCount;
    for (let i = 0; i < excess; i++) {
      const [key] = userRecords[i]!;
      this.db.yggdrasilTokens.delete(key);
    }
  }

  private isLiveUserToken(key: string, userId: string): boolean {
    const record = this.db.yggdrasilTokens.get(key);
    return !!record && record.entry.userId === userId && record.expiresAt > Date.now();
  }
}

@Injectable()
export class YggdrasilMapSessionStore implements IYggdrasilSessionStore {
  constructor(private readonly db: MemoryDb) {}

  async saveSession(serverId: string, entry: SessionEntry): Promise<void> {
    this.db.yggdrasilSessions.set(serverId, {
      entry,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
  }

  async findSession(serverId: string): Promise<SessionEntry | undefined> {
    const record = this.db.yggdrasilSessions.get(serverId);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.db.yggdrasilSessions.delete(serverId);
      return undefined;
    }
    return record.entry;
  }
}
