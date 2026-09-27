import { Injectable } from "@nestjs/common";

export interface CacheEntryRecord {
  value: string;
  expiresAt: number;
}

export interface MemoryUserRecord {
  uuid: string;
  username: string;
  passwordHash: string;
  role: string;
  approved: boolean;
  banned: boolean;
  deleted: boolean;
  deletedAt: Date | null;
  passwordChangedAt?: Date | undefined;
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

export interface YggdrasilTokenRecord {
  entry: TokenEntry;
  issuedAt: number;
  expiresAt: number;
}

export interface YggdrasilSessionRecord {
  entry: SessionEntry;
  expiresAt: number;
}

@Injectable()
export class MemoryDb {
  readonly users = new Map<string, MemoryUserRecord>();
  readonly yggdrasilTokens = new Map<string, YggdrasilTokenRecord>();
  readonly yggdrasilSessions = new Map<string, YggdrasilSessionRecord>();
  readonly cacheEntries = new Map<string, CacheEntryRecord>();
}
