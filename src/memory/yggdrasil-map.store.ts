import { Injectable } from "@nestjs/common";
import {
  MAX_TOKENS_PER_USER,
  SESSION_TTL_MS,
  TOKEN_TTL_MS,
  type IYggdrasilSessionStore,
  type IYggdrasilTokenStore,
  type SessionEntry,
  type TokenEntry,
} from "../yggdrasil/service/yggdrasil_store";
import type { MemoryDb } from "./memory-db";

@Injectable()
export class YggdrasilMapTokenStore implements IYggdrasilTokenStore {
  constructor(private readonly db: MemoryDb) {}

  async saveToken(accessToken: string, entry: TokenEntry): Promise<void> {
    this.deleteExpiredTokens();
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

  private deleteExpiredTokens(): void {
    const now = Date.now();
    for (const [key, record] of this.db.yggdrasilTokens) {
      if (record.expiresAt <= now) this.db.yggdrasilTokens.delete(key);
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
    this.deleteExpiredSessions();
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

  private deleteExpiredSessions(): void {
    const now = Date.now();
    for (const [key, record] of this.db.yggdrasilSessions) {
      if (record.expiresAt <= now) this.db.yggdrasilSessions.delete(key);
    }
  }
}
