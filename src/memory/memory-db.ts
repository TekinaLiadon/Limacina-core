import { Injectable } from "@nestjs/common";
import type {
  YggdrasilSessionRecord,
  YggdrasilTokenRecord,
} from "../yggdrasil/service/yggdrasil_store";

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

@Injectable()
export class MemoryDb {
  readonly users = new Map<string, MemoryUserRecord>();
  readonly yggdrasilTokens = new Map<string, YggdrasilTokenRecord>();
  readonly yggdrasilSessions = new Map<string, YggdrasilSessionRecord>();
  readonly cacheEntries = new Map<string, CacheEntryRecord>();
}
