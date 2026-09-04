import { Injectable } from "@nestjs/common";
import type { IAuthStore, RefreshEntry, StoredUser } from "../auth/service/auth_store.service";
import type { MemoryDb } from "./memory-db";

@Injectable()
export class AuthMapStore implements IAuthStore {
  constructor(private readonly db: MemoryDb) {}

  async findByUsername(username: string): Promise<StoredUser | undefined> {
    return this.db.users.get(username);
  }

  async saveUser(user: StoredUser): Promise<void> {
    this.db.users.set(user.username, user);
  }

  async userExists(username: string): Promise<boolean> {
    return this.db.users.has(username);
  }

  async updatePasswordHash(uuid: string, passwordHash: string, changedAt: Date): Promise<void> {
    const user = this.findUserByUuid(uuid);
    if (!user) return;
    user.passwordHash = passwordHash;
    user.passwordChangedAt = changedAt;
  }

  async approveUser(uuid: string): Promise<void> {
    const user = this.findUserByUuid(uuid);
    if (user) user.approved = true;
  }

  async updateSkin(uuid: string, skin: string): Promise<void> {
    const user = this.findUserByUuid(uuid);
    if (user) user.skin = skin;
  }

  async updateRole(uuid: string, role: string): Promise<void> {
    const user = this.findUserByUuid(uuid);
    if (user) user.role = role;
  }

  async saveRefresh(jti: string, entry: RefreshEntry): Promise<void> {
    this.db.refreshTokens.set(jti, entry);
  }

  async findRefresh(jti: string): Promise<RefreshEntry | undefined> {
    return this.db.refreshTokens.get(jti);
  }

  async deleteRefresh(jti: string): Promise<void> {
    this.db.refreshTokens.delete(jti);
  }

  async deleteRefreshByUserId(userId: string): Promise<void> {
    for (const [key, val] of this.db.refreshTokens) {
      if (val.userId === userId) this.db.refreshTokens.delete(key);
    }
  }

  private findUserByUuid(uuid: string): StoredUser | undefined {
    for (const user of this.db.users.values()) {
      if (user.uuid === uuid) return user;
    }
    return undefined;
  }
}
