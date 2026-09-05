import { Injectable } from "@nestjs/common";
import type {
  YggdrasilSessionRecord,
  YggdrasilTokenRecord,
} from "../yggdrasil/service/yggdrasil_store";

export interface CacheEntryRecord {
  value: string;
  expiresAt: number;
}

@Injectable()
export class MemoryDb {
  readonly yggdrasilTokens = new Map<string, YggdrasilTokenRecord>();
  readonly yggdrasilSessions = new Map<string, YggdrasilSessionRecord>();
  readonly cacheEntries = new Map<string, CacheEntryRecord>();
}
