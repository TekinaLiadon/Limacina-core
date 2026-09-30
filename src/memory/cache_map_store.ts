import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  assertValidCacheTtl,
  parseCacheValue,
  serializeCacheValue,
  type ICacheStore,
} from "../cache/cache_store";
import type { CacheEntryRecord, MemoryDb } from "./memory-db";

const CORRUPTED_VALUE_MESSAGE = "Повреждённое значение в кеш-сторе, ключ удалён";

function entryExpired(entry: CacheEntryRecord): boolean {
  return entry.expiresAt <= Date.now();
}

@Injectable()
export class CacheMapStore implements ICacheStore {
  private readonly logger = new Logger(CacheMapStore.name);

  constructor(
    private readonly db: MemoryDb,
    private readonly maxEntries: number = MAX_CACHE_ENTRIES,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.db.cacheEntries.get(key);
    if (!entry) return undefined;

    if (entryExpired(entry)) {
      this.db.cacheEntries.delete(key);
      return undefined;
    }

    this.touchEntry(key, entry);
    const parsed = parseCacheValue<T>(this.logger, key, entry.value, CORRUPTED_VALUE_MESSAGE);
    if (parsed === undefined) {
      this.db.cacheEntries.delete(key);
    }
    return parsed;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (!assertValidCacheTtl(this.logger, key, ttlMs)) return;

    const payload = serializeCacheValue(this.logger, key, value);
    if (payload === undefined) return;

    if (!this.db.cacheEntries.has(key)) {
      this.evictFilledSlots();
    }

    const entry: CacheEntryRecord = {
      value: payload,
      expiresAt: Date.now() + (ttlMs ?? DEFAULT_CACHE_TTL_MS),
    };
    this.touchEntry(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.db.cacheEntries.delete(key);
  }

  private touchEntry(key: string, entry: CacheEntryRecord): void {
    this.db.cacheEntries.delete(key);
    this.db.cacheEntries.set(key, entry);
  }

  private evictFilledSlots(): void {
    if (this.db.cacheEntries.size < this.maxEntries) return;
    this.purgeExpiredEntries();
    while (this.db.cacheEntries.size >= this.maxEntries) {
      const oldestKey = this.db.cacheEntries.keys().next().value;
      if (oldestKey === undefined) break;
      this.db.cacheEntries.delete(oldestKey);
    }
  }

  private purgeExpiredEntries(): void {
    for (const [key, entry] of this.db.cacheEntries) {
      if (entryExpired(entry)) {
        this.db.cacheEntries.delete(key);
      }
    }
  }
}
