export const CacheStoreToken = Symbol("CacheStore");

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_CACHE_ENTRIES = 1000;

export interface ICacheStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
