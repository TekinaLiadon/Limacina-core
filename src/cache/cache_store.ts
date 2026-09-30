import { Logger } from "@nestjs/common";

export const CacheStoreToken = Symbol("CacheStore");

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_CACHE_ENTRIES = 1000;

export function isValidCacheTtl(ttlMs: number | undefined): boolean {
  if (ttlMs === undefined) return true;
  return Number.isFinite(ttlMs) && ttlMs > 0;
}

const INVALID_VALUE_MESSAGE = "Несериализуемое значение не сохранено в кеш";
const INVALID_TTL_MESSAGE = "Невалидный ttl, значение не сохранено в кеш";

export function assertValidCacheTtl(
  logger: Logger,
  key: string,
  ttlMs: number | undefined,
): boolean {
  if (isValidCacheTtl(ttlMs)) return true;
  logger.error({ key, ttlMs }, INVALID_TTL_MESSAGE);
  return false;
}

export function serializeCacheValue<T>(logger: Logger, key: string, value: T): string | undefined {
  try {
    const payload = JSON.stringify(value);
    if (payload !== undefined) return payload;
  } catch (error) {
    logger.error({ err: error, key }, INVALID_VALUE_MESSAGE);
    return undefined;
  }
  logger.error({ key }, INVALID_VALUE_MESSAGE);
  return undefined;
}

export function parseCacheValue<T>(
  logger: Logger,
  key: string,
  raw: string,
  failureMessage: string,
): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.error({ key }, failureMessage);
    return undefined;
  }
}

export interface ICacheStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
