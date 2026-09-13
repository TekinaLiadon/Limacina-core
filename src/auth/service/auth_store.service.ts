import { Injectable } from "@nestjs/common";
import { MAX_REFRESH_TOKENS_PER_USER } from "../token.constants";

export interface StoredUser {
  uuid: string;
  username: string;
  passwordHash: string;
  role: string;
  approved: boolean;
  banned: boolean;
  passwordChangedAt?: Date | undefined;
}

export interface RefreshEntry {
  userId: string;
  username: string;
}

export const AuthMapStoreToken = Symbol("AuthMapStore");

export interface IAuthStore {
  findByUsername(username: string): Promise<StoredUser | undefined>;
  saveUser(user: StoredUser): Promise<boolean>;
  setApproved(uuid: string, approved: boolean): Promise<void>;
  setBanned(uuid: string, banned: boolean): Promise<void>;
  userExists(username: string): Promise<boolean>;
  replacePassword(uuid: string, passwordHash: string, changedAt: Date): Promise<void>;
  updateRole(uuid: string, role: string): Promise<void>;
  deleteUser(uuid: string): Promise<void>;
  restoreUser(uuid: string): Promise<void>;
  saveRefresh(jti: string, entry: RefreshEntry, expiresAt: Date): Promise<void>;
  claimRefresh(jti: string): Promise<RefreshEntry | undefined>;
  findRefresh(jti: string): Promise<RefreshEntry | undefined>;
  deleteRefresh(jti: string): Promise<void>;
  deleteRefreshByUserId(userId: string): Promise<void>;
}

interface StoredAuthUser extends StoredUser {
  deleted: boolean;
  deletedAt: Date | null;
}

interface StoredRefreshEntry extends RefreshEntry {
  createdAt: number;
  expiresAt: number;
}

function toStoredUser(user: StoredAuthUser): StoredUser {
  return {
    uuid: user.uuid,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    approved: user.approved,
    banned: user.banned,
    passwordChangedAt: user.passwordChangedAt,
  };
}

@Injectable()
export class AuthMapStore implements IAuthStore {
  private readonly users = new Map<string, StoredAuthUser>();
  private readonly tokens = new Map<string, StoredRefreshEntry>();

  async findByUsername(username: string): Promise<StoredUser | undefined> {
    const user = this.liveUser(username);
    if (!user) return undefined;
    return toStoredUser(user);
  }

  async saveUser(user: StoredUser): Promise<boolean> {
    const conflicting = this.findLiveUserCaseInsensitive(user.username);
    if (conflicting && conflicting.uuid !== user.uuid) return false;
    if (this.users.get(user.uuid)?.deleted) return false;
    this.users.set(user.uuid, { ...user, deleted: false, deletedAt: null });
    return true;
  }

  async setApproved(uuid: string, approved: boolean): Promise<void> {
    const user = this.users.get(uuid);
    if (user) user.approved = approved;
  }

  async setBanned(uuid: string, banned: boolean): Promise<void> {
    const user = this.users.get(uuid);
    if (user) user.banned = banned;
  }

  async userExists(username: string): Promise<boolean> {
    return this.findLiveUserCaseInsensitive(username) !== undefined;
  }

  async replacePassword(uuid: string, passwordHash: string, changedAt: Date): Promise<void> {
    const user = this.users.get(uuid);
    if (!user) return;
    user.passwordHash = passwordHash;
    user.passwordChangedAt = changedAt;
    this.deleteTokensOfUser(uuid);
  }

  async updateRole(uuid: string, role: string): Promise<void> {
    const user = this.users.get(uuid);
    if (user) user.role = role;
  }

  async deleteUser(uuid: string): Promise<void> {
    const user = this.users.get(uuid);
    if (!user || user.deleted) return;
    user.deleted = true;
    user.deletedAt = new Date();
  }

  async restoreUser(uuid: string): Promise<void> {
    const user = this.users.get(uuid);
    if (!user || !user.deleted) return;
    user.deleted = false;
    user.deletedAt = null;
  }

  async saveRefresh(jti: string, entry: RefreshEntry, expiresAt: Date): Promise<void> {
    this.tokens.set(jti, {
      ...entry,
      createdAt: Date.now(),
      expiresAt: expiresAt.getTime(),
    });
    this.expireRefreshTokens();
    this.evictRefreshTokensOverLimit(entry.userId);
  }

  async claimRefresh(jti: string): Promise<RefreshEntry | undefined> {
    const entry = this.liveRefreshEntry(jti);
    if (!entry) return undefined;
    this.tokens.delete(jti);
    return { userId: entry.userId, username: entry.username };
  }

  async findRefresh(jti: string): Promise<RefreshEntry | undefined> {
    const entry = this.liveRefreshEntry(jti);
    if (!entry) return undefined;
    return { userId: entry.userId, username: entry.username };
  }

  async deleteRefresh(jti: string): Promise<void> {
    this.tokens.delete(jti);
  }

  async deleteRefreshByUserId(userId: string): Promise<void> {
    this.deleteTokensOfUser(userId);
  }

  async __test__deleteUser(username: string): Promise<void> {
    for (const [uuid, user] of this.users) {
      if (user.username === username) this.users.delete(uuid);
    }
  }

  private liveRefreshEntry(jti: string): StoredRefreshEntry | undefined {
    const entry = this.tokens.get(jti);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.tokens.delete(jti);
      return undefined;
    }
    return entry;
  }

  private expireRefreshTokens(): void {
    const now = Date.now();
    for (const [jti, entry] of this.tokens) {
      if (entry.expiresAt <= now) this.tokens.delete(jti);
    }
  }

  private evictRefreshTokensOverLimit(userId: string): void {
    const userTokens: string[] = [];
    for (const [jti, entry] of this.tokens) {
      if (entry.userId === userId) userTokens.push(jti);
    }
    for (let i = 0; i < userTokens.length - MAX_REFRESH_TOKENS_PER_USER; i++) {
      this.tokens.delete(userTokens[i]!);
    }
  }

  private deleteTokensOfUser(userId: string): void {
    for (const [key, val] of this.tokens) {
      if (val.userId === userId) this.tokens.delete(key);
    }
  }

  private liveUser(username: string): StoredAuthUser | undefined {
    for (const user of this.users.values()) {
      if (user.username === username && !user.deleted) return user;
    }
    return undefined;
  }

  private findLiveUserCaseInsensitive(username: string): StoredAuthUser | undefined {
    const lower = username.toLowerCase();
    for (const user of this.users.values()) {
      if (user.deleted) continue;
      if (user.username.toLowerCase() === lower) return user;
    }
    return undefined;
  }
}
