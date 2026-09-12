process.env["JWT_ACCESS"] = "test-access-secret-0123456789abcdef0123";
process.env["JWT_REFRESH"] = "test-refresh-secret-0123456789abcdef0123";
process.env["NODE_ENV"] = "test";
process.env["BASE_URL"] = "http://localhost:3005";
process.env["DB_DRIVER"] = "map";
delete process.env["REDIS_URL"];

import { describe, expect, it } from "bun:test";
import type { ICacheStore } from "../cache.store";
import { CacheMapStore } from "../../memory/cache-map.store";
import { MemoryDb } from "../../memory/memory-db";
import { RedisCacheStore, type RedisClientLike } from "../redis.store";

class FakeRedisClient implements RedisClientLike {
  readonly stored = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.stored.get(key) ?? null;
  }

  async set(key: string, value: string, _px: "PX", _milliseconds: number): Promise<unknown> {
    this.stored.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.stored.delete(key) ? 1 : 0;
  }

  close(): void {}
}

interface CacheStoreHarness {
  store: ICacheStore;
  rawHas: (key: string) => boolean;
  poison: (key: string, rawValue: string) => void;
}

interface CacheStoreCase {
  driverName: string;
  buildHarness: () => CacheStoreHarness;
}

const cacheStoreCases: CacheStoreCase[] = [
  {
    driverName: "CacheMapStore",
    buildHarness: () => {
      const db = new MemoryDb();
      return {
        store: new CacheMapStore(db),
        rawHas: (key) => db.cacheEntries.has(key),
        poison: (key, rawValue) =>
          db.cacheEntries.set(key, { value: rawValue, expiresAt: Date.now() + 60_000 }),
      };
    },
  },
  {
    driverName: "RedisCacheStore",
    buildHarness: () => {
      const client = new FakeRedisClient();
      return {
        store: new RedisCacheStore(client),
        rawHas: (key) => client.stored.has(key),
        poison: (key, rawValue) => client.stored.set(key, rawValue),
      };
    },
  },
];

describe.each(cacheStoreCases)("контракт ICacheStore — $driverName", ({ buildHarness }): void => {
  it("set + get возвращает исходное значение", async (): Promise<void> => {
    const { store } = buildHarness();

    await store.set("contract:value", { online: 5, max: 100 }, 60_000);

    expect(await store.get<{ online: number; max: number }>("contract:value")).toEqual({
      online: 5,
      max: 100,
    });
  });

  it("set с несериализуемым значением не бросает и не создаёт ключ", async (): Promise<void> => {
    const { store, rawHas } = buildHarness();

    await store.set("contract:unserializable", undefined);
    await store.set("contract:bigint", { size: BigInt(1) });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await store.set("contract:circular", circular);

    expect(rawHas("contract:unserializable")).toBe(false);
    expect(rawHas("contract:bigint")).toBe(false);
    expect(rawHas("contract:circular")).toBe(false);
    expect(await store.get("contract:unserializable")).toBeUndefined();
  });

  it("повторный set после несериализуемого значения работает", async (): Promise<void> => {
    const { store } = buildHarness();

    await store.set("contract:recover", undefined);
    await store.set("contract:recover", "value");

    expect(await store.get<string>("contract:recover")).toBe("value");
  });

  it("повреждённое значение под ключом — промах, а не сбой", async (): Promise<void> => {
    const { store, poison } = buildHarness();

    poison("contract:poisoned", "{broken");

    expect(await store.get("contract:poisoned")).toBeUndefined();
  });

  it("get после повреждённого значения самоисцеляется перезаписью", async (): Promise<void> => {
    const { store, poison } = buildHarness();

    poison("contract:heal", "{broken");
    await store.set("contract:heal", "fresh", 30_000);

    expect(await store.get<string>("contract:heal")).toBe("fresh");
  });

  it("set с невалидным ttl не бросает и не кеширует значение", async (): Promise<void> => {
    const { store, rawHas } = buildHarness();

    await store.set("contract:ttl-zero", "value", 0);
    await store.set("contract:ttl-negative", "value", -1_000);
    await store.set("contract:ttl-infinite", "value", Infinity);
    await store.set("contract:ttl-nan", "value", Number.NaN);

    expect(await store.get("contract:ttl-zero")).toBeUndefined();
    expect(await store.get("contract:ttl-negative")).toBeUndefined();
    expect(await store.get("contract:ttl-infinite")).toBeUndefined();
    expect(await store.get("contract:ttl-nan")).toBeUndefined();
    expect(rawHas("contract:ttl-zero")).toBe(false);
    expect(rawHas("contract:ttl-negative")).toBe(false);
    expect(rawHas("contract:ttl-infinite")).toBe(false);
    expect(rawHas("contract:ttl-nan")).toBe(false);
  });

  it("валидный ttl после невалидного работает", async (): Promise<void> => {
    const { store } = buildHarness();

    await store.set("contract:ttl-retry", "value", 0);
    await store.set("contract:ttl-retry", "value", 30_000);

    expect(await store.get<string>("contract:ttl-retry")).toBe("value");
  });
});
