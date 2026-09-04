process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";
delete process.env["REDIS_URL"];

import { describe, expect, it } from "bun:test";
import { Test } from "@nestjs/testing";
import { buildCachePrefix, CacheModule, createCacheStore } from "../cache.module";
import { CacheStoreToken, DEFAULT_CACHE_TTL_MS, type ICacheStore } from "../cache.store";
import { RedisCacheStore } from "../redis.store";
import { CacheMapStore } from "../../memory/cache-map.store";
import { MemoryDb } from "../../memory/memory-db";
import type { AppConfigType } from "../../config/global-config";

function buildTestConfig(redisUrl: string | undefined): AppConfigType {
  return { NODE_ENV: "test", REDIS_URL: redisUrl } as unknown as AppConfigType;
}

describe("CacheMapStore", (): void => {
  it("возвращает undefined для отсутствующего ключа", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb());

    expect(await store.get("missing")).toBeUndefined();
  });

  it("сохраняет и возвращает значение", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb());

    await store.set("status", { online: 5, max: 100 }, 60_000);

    const cached = await store.get<{ online: number; max: number }>("status");
    expect(cached).toEqual({ online: 5, max: 100 });
  });

  it("возвращает копию значения — мутация результата не портит кеш", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb());

    await store.set("status", { online: 5 }, 60_000);
    const first = await store.get<{ online: number }>("status");
    first!.online = 999;

    const second = await store.get<{ online: number }>("status");
    expect(second).toEqual({ online: 5 });
  });

  it("перезаписывает значение по тому же ключу", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb());

    await store.set("key", "first");
    await store.set("key", "second");

    const cached = await store.get<string>("key");
    expect(cached).toBe("second");
  });

  it("удаляет значение", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb());

    await store.set("key", "value");
    await store.delete("key");

    expect(await store.get("key")).toBeUndefined();
  });

  it("запись без ttl получает дефолтные 5 минут", async (): Promise<void> => {
    const db = new MemoryDb();
    const store = new CacheMapStore(db);
    const before = Date.now();

    await store.set("key", "value");

    const expiresAt = db.cacheEntries.get("key")?.expiresAt;
    expect(expiresAt).toBeGreaterThan(before + DEFAULT_CACHE_TTL_MS - 1_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + DEFAULT_CACHE_TTL_MS);
  });

  it("истёкшая запись не возвращается и вычищается", async (): Promise<void> => {
    const db = new MemoryDb();
    db.cacheEntries.set("stale", { value: '"old"', expiresAt: Date.now() - 1 });
    const store = new CacheMapStore(db);

    expect(await store.get("stale")).toBeUndefined();
    expect(db.cacheEntries.has("stale")).toBe(false);
  });

  it("запись с будущим ttl доступна", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb());

    await store.set("fresh", "value", 60_000);

    const cached = await store.get<string>("fresh");
    expect(cached).toBe("value");
  });

  it("вытесняет наименее используемую запись при достижении лимита", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb(), 2);

    await store.set("a", "A");
    await store.set("b", "B");
    const bumped = await store.get<string>("a");
    expect(bumped).toBe("A");

    await store.set("c", "C");

    expect(await store.get<string>("b")).toBeUndefined();
    expect(await store.get<string>("a")).toBe("A");
    expect(await store.get<string>("c")).toBe("C");
  });

  it("перезапись существующего ключа не вытесняет другие записи", async (): Promise<void> => {
    const store = new CacheMapStore(new MemoryDb(), 2);

    await store.set("a", "A");
    await store.set("b", "B");
    await store.set("a", "A2");
    await store.set("c", "C");

    expect(await store.get<string>("b")).toBeUndefined();
    expect(await store.get<string>("a")).toBe("A2");
  });
});

describe("createCacheStore", (): void => {
  it("без REDIS_URL возвращает стор над локальной мапой", (): void => {
    const store = createCacheStore(buildTestConfig(undefined), new MemoryDb());

    expect(store).toBeInstanceOf(CacheMapStore);
  });

  it("с REDIS_URL возвращает стор над Redis", (): void => {
    const store = createCacheStore(buildTestConfig("redis://localhost:6379"), new MemoryDb());

    expect(store).toBeInstanceOf(RedisCacheStore);
  });
});

describe("buildCachePrefix", (): void => {
  it("по умолчанию изолирует ключи по окружению", (): void => {
    expect(buildCachePrefix(buildTestConfig(undefined))).toBe("limacina:test");
  });

  it("CACHE_PREFIX переопределяет дефолт", (): void => {
    const config = { ...buildTestConfig(undefined), CACHE_PREFIX: "staging" };

    expect(buildCachePrefix(config)).toBe("staging");
  });
});

describe("CacheModule", (): void => {
  it("предоставляет ICacheStore поверх общего MemoryDb", async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({ imports: [CacheModule] }).compile();
    const cache = moduleRef.get<ICacheStore>(CacheStoreToken);

    await cache.set("wired", true);

    expect(await cache.get<boolean>("wired")).toBe(true);
    expect(moduleRef.get(MemoryDb).cacheEntries.has("wired")).toBe(true);
  });
});
