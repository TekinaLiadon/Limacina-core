import { Injectable } from "@nestjs/common";

export interface StoredUser {
  uuid: string;
  username: string;
  passwordHash: string;
}

export interface RefreshEntry {
  userId: string;
  username: string;
}

export interface IAuthStore {
  findByUsername(username: string): StoredUser | undefined;
  saveUser(user: StoredUser): void;
  userExists(username: string): boolean;
  saveRefresh(jti: string, entry: RefreshEntry): void;
  findRefresh(jti: string): RefreshEntry | undefined;
  deleteRefresh(jti: string): void;
  deleteRefreshByUserId(userId: string): void;
}

@Injectable()
export class AuthMapStore implements IAuthStore {
  private readonly users = new Map<string, StoredUser>();
  private readonly tokens = new Map<string, RefreshEntry>();

  findByUsername(username: string): StoredUser | undefined {
    return this.users.get(username);
  }

  saveUser(user: StoredUser): void {
    this.users.set(user.username, user);
  }

  userExists(username: string): boolean {
    return this.users.has(username);
  }

  saveRefresh(jti: string, entry: RefreshEntry): void {
    this.tokens.set(jti, entry);
  }

  findRefresh(jti: string): RefreshEntry | undefined {
    return this.tokens.get(jti);
  }

  deleteRefresh(jti: string): void {
    this.tokens.delete(jti);
  }

  deleteRefreshByUserId(userId: string): void {
    for (const [key, val] of this.tokens) {
      if (val.userId === userId) this.tokens.delete(key);
    }
  }
}
