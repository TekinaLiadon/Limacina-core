import { Injectable } from "@nestjs/common";
import { DEFAULT_CACHE_TTL_MS, MAX_CACHE_ENTRIES, type ICacheStore } from "../cache/cache.store";
import type { CacheEntryRecord, MemoryDb } from "./memory-db";

function entryExpired(entry: CacheEntryRecord): boolean {
  return entry.expiresAt <= Date.now();
}

@Injectable()
export class CacheMapStore implements ICacheStore {
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
    return JSON.parse(entry.value) as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (!this.db.cacheEntries.has(key)) {
      this.evictFilledSlots();
    }

    const entry: CacheEntryRecord = {
      value: JSON.stringify(value),
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
    while (this.db.cacheEntries.size >= this.maxEntries) {
      const oldestKey = this.db.cacheEntries.keys().next().value;
      if (oldestKey === undefined) break;
      this.db.cacheEntries.delete(oldestKey);
    }
  }
}
