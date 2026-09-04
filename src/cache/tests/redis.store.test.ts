import { describe, expect, it } from "bun:test";
import { DEFAULT_CACHE_TTL_MS } from "../cache.store";
import { COMMAND_TIMEOUT_MS, RedisCacheStore, type RedisClientLike } from "../redis.store";

class FakeRedisClient implements RedisClientLike {
  readonly stored = new Map<string, string>();
  lastSet: { key: string; value: string; px: string; milliseconds: number } | null = null;
  failMode = false;
  closed = false;

  async get(key: string): Promise<string | null> {
    if (this.failMode) throw new Error("redis unavailable");
    return this.stored.get(key) ?? null;
  }

  async set(key: string, value: string, px: "PX", milliseconds: number): Promise<unknown> {
    if (this.failMode) throw new Error("redis unavailable");
    this.lastSet = { key, value, px, milliseconds };
    this.stored.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    if (this.failMode) throw new Error("redis unavailable");
    return this.stored.delete(key) ? 1 : 0;
  }

  close(): void {
    this.closed = true;
  }
}

describe("RedisCacheStore", (): void => {
  it("get возвращает десериализованное значение", async (): Promise<void> => {
    const client = new FakeRedisClient();
    client.stored.set("status", JSON.stringify({ online: 5 }));
    const store = new RedisCacheStore(client);

    const cached = await store.get<{ online: number }>("status");

    expect(cached).toEqual({ online: 5 });
  });

  it("get для отсутствующего ключа возвращает undefined", async (): Promise<void> => {
    const store = new RedisCacheStore(new FakeRedisClient());

    expect(await store.get("missing")).toBeUndefined();
  });

  it("set сериализует значение и передаёт PX с дефолтным ttl", async (): Promise<void> => {
    const client = new FakeRedisClient();
    const store = new RedisCacheStore(client);

    await store.set("status", { online: 5 });

    expect(client.lastSet).toEqual({
      key: "status",
      value: JSON.stringify({ online: 5 }),
      px: "PX",
      milliseconds: DEFAULT_CACHE_TTL_MS,
    });
  });

  it("set передаёт явный ttl", async (): Promise<void> => {
    const client = new FakeRedisClient();
    const store = new RedisCacheStore(client);

    await store.set("key", "value", 30_000);

    expect(client.lastSet?.milliseconds).toBe(30_000);
  });

  it("delete удаляет ключ", async (): Promise<void> => {
    const client = new FakeRedisClient();
    client.stored.set("key", "value");
    const store = new RedisCacheStore(client);

    await store.delete("key");

    expect(client.stored.has("key")).toBe(false);
  });

  it("недоступность Redis — get деградирует в промах", async (): Promise<void> => {
    const client = new FakeRedisClient();
    client.failMode = true;
    const store = new RedisCacheStore(client);

    expect(await store.get("key")).toBeUndefined();
  });

  it("недоступность Redis — set не бросает", async (): Promise<void> => {
    const client = new FakeRedisClient();
    client.failMode = true;
    const store = new RedisCacheStore(client);

    await store.set("key", "value");
  });

  it("недоступность Redis — delete не бросает", async (): Promise<void> => {
    const client = new FakeRedisClient();
    client.failMode = true;
    const store = new RedisCacheStore(client);

    await store.delete("key");
  });

  it("закрывает клиент при разрушении модуля", (): void => {
    const client = new FakeRedisClient();
    const store = new RedisCacheStore(client);

    store.onModuleDestroy();

    expect(client.closed).toBe(true);
  });
});

class HangingRedisClient implements RedisClientLike {
  closed = false;

  async get(): Promise<string | null> {
    return new Promise<string | null>(() => {});
  }

  async set(): Promise<unknown> {
    return new Promise<unknown>(() => {});
  }

  async del(): Promise<number> {
    return new Promise<number>(() => {});
  }

  close(): void {
    this.closed = true;
  }
}

describe("RedisCacheStore — таймаут команд", (): void => {
  it("get не ждёт зависший Redis дольше таймаута", async (): Promise<void> => {
    const store = new RedisCacheStore(new HangingRedisClient());

    const started = Date.now();
    const cached = await store.get("status");

    expect(cached).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(COMMAND_TIMEOUT_MS * 4);
  });

  it("set не ждёт зависший Redis дольше таймаута", async (): Promise<void> => {
    const store = new RedisCacheStore(new HangingRedisClient());

    const started = Date.now();
    await store.set("status", { online: 1 });

    expect(Date.now() - started).toBeLessThan(COMMAND_TIMEOUT_MS * 4);
  });

  it("delete не ждёт зависший Redis дольше таймаута", async (): Promise<void> => {
    const store = new RedisCacheStore(new HangingRedisClient());

    const started = Date.now();
    await store.delete("status");

    expect(Date.now() - started).toBeLessThan(COMMAND_TIMEOUT_MS * 4);
  });
});

describe("RedisCacheStore — префикс ключей", (): void => {
  it("применяет префикс ко всем операциям", async (): Promise<void> => {
    const client = new FakeRedisClient();
    const store = new RedisCacheStore(client, "limacina:staging");

    await store.set("status", { online: 5 });

    expect(client.lastSet?.key).toBe("limacina:staging:status");
    expect(await store.get<{ online: number }>("status")).toEqual({ online: 5 });

    await store.delete("status");
    expect(client.stored.has("limacina:staging:status")).toBe(false);
  });

  it("не видит ключи другого префикса", async (): Promise<void> => {
    const client = new FakeRedisClient();
    const production = new RedisCacheStore(client, "limacina:production");
    const staging = new RedisCacheStore(client, "limacina:staging");

    await production.set("launcher-files-list", { file: "prod" });

    expect(await staging.get("launcher-files-list")).toBeUndefined();
    expect(await production.get<{ file: string }>("launcher-files-list")).toEqual({
      file: "prod",
    });
  });

  it("без префикса ключ остаётся исходным", async (): Promise<void> => {
    const client = new FakeRedisClient();
    const store = new RedisCacheStore(client);

    await store.set("status", 1);

    expect(client.lastSet?.key).toBe("status");
  });
});
