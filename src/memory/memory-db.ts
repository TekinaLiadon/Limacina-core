import { Injectable } from "@nestjs/common";
import type { RefreshEntry, StoredUser } from "../auth/service/auth_store.service";
import type {
  YggdrasilSessionRecord,
  YggdrasilTokenRecord,
  YggdrasilProfile,
} from "../yggdrasil/service/yggdrasil_store";
import type { UserContentItem } from "../user-content/user-content.store";

export type DeletedUserRecord = StoredUser & { deletedAt: Date };

export interface CacheEntryRecord {
  value: string;
  expiresAt: number;
}

@Injectable()
export class MemoryDb {
  readonly users = new Map<string, StoredUser>();
  readonly deletedUsers = new Map<string, DeletedUserRecord>();
  readonly refreshTokens = new Map<string, RefreshEntry>();
  readonly yggdrasilProfiles = new Map<string, YggdrasilProfile>();
  readonly yggdrasilTokens = new Map<string, YggdrasilTokenRecord>();
  readonly yggdrasilSessions = new Map<string, YggdrasilSessionRecord>();
  readonly userSkins = new Map<number, UserContentItem>();
  readonly userModels = new Map<number, UserContentItem>();
  readonly cacheEntries = new Map<string, CacheEntryRecord>();
  nextUserSkinId = 1;
  nextUserModelId = 1;
}
