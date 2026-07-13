import { Injectable } from "@nestjs/common";

export interface StoredUser {
  uuid: string;
  username: string;
  passwordHash: string;
  skin: string | null;
  role: string;
  approved: boolean;
  banned: boolean;
}

export interface RefreshEntry {
  userId: string;
  username: string;
}

export const AuthMapStoreToken = Symbol("AuthMapStore");

export interface IAuthStore {
  findByUsername(username: string): Promise<StoredUser | undefined>;
  saveUser(user: StoredUser): Promise<void>;
  approveUser(uuid: string): Promise<void>;
  userExists(username: string): Promise<boolean>;
  updateSkin(uuid: string, skin: string): Promise<void>;
  saveRefresh(jti: string, entry: RefreshEntry): Promise<void>;
  findRefresh(jti: string): Promise<RefreshEntry | undefined>;
  deleteRefresh(jti: string): Promise<void>;
  deleteRefreshByUserId(userId: string): Promise<void>;
}

@Injectable()
export class AuthMapStore implements IAuthStore {
  private readonly users = new Map<string, StoredUser>();
  private readonly tokens = new Map<string, RefreshEntry>();

  async findByUsername(username: string): Promise<StoredUser | undefined> {
    return this.users.get(username);
  }

  async saveUser(user: StoredUser): Promise<void> {
    this.users.set(user.username, user);
  }

  async approveUser(uuid: string): Promise<void> {
    for (const user of this.users.values()) {
      if (user.uuid === uuid) {
        user.approved = true;
        return;
      }
    }
  }

  async userExists(username: string): Promise<boolean> {
    return this.users.has(username);
  }

  async updateSkin(uuid: string, skin: string): Promise<void> {
    for (const user of this.users.values()) {
      if (user.uuid === uuid) {
        user.skin = skin;
        return;
      }
    }
  }

  async saveRefresh(jti: string, entry: RefreshEntry): Promise<void> {
    this.tokens.set(jti, entry);
  }

  async findRefresh(jti: string): Promise<RefreshEntry | undefined> {
    return this.tokens.get(jti);
  }

  async deleteRefresh(jti: string): Promise<void> {
    this.tokens.delete(jti);
  }

  async deleteRefreshByUserId(userId: string): Promise<void> {
    for (const [key, val] of this.tokens) {
      if (val.userId === userId) this.tokens.delete(key);
    }
  }
}
