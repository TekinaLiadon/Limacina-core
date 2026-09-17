import { describe, expect, it } from "bun:test";
import { RedisRateLimitStore, type RateLimitRedisClientLike } from "../rate-limit-redis-store";

class FakeZsetRedis implements RateLimitRedisClientLike {
  readonly zsets = new Map<string, Map<string, number>>();
  readonly commands: string[] = [];
  readonly pexpires: { key: string; ms: number }[] = [];
  failMode = false;
  closed = false;
  connectCalls = 0;
  onclose: ((error: Error) => void) | null = null;
  onconnect: (() => void) | null = null;

  async send(command: string, args: string[]): Promise<unknown> {
    this.commands.push(command);
    if (this.failMode) throw new Error("redis unavailable");

    const key = args[0]!;
    if (command === "ZADD") {
      const zset = this.zsets.get(key) ?? new Map<string, number>();
      zset.set(args[2]!, Number(args[1]));
      this.zsets.set(key, zset);
      return 1;
    }
    if (command === "ZREMRANGEBYSCORE") {
      const zset = this.zsets.get(key);
      if (zset === undefined) return 0;
      const max = Number(args[2]);
      let removed = 0;
      for (const [member, score] of zset) {
        if (score <= max) {
          zset.delete(member);
          removed += 1;
        }
      }
      return removed;
    }
    if (command === "ZCARD") {
      return this.zsets.get(key)?.size ?? 0;
    }
    if (command === "PEXPIRE") {
      this.pexpires.push({ key, ms: Number(args[1]) });
      return 1;
    }
    if (command === "ZRANGE") {
      const zset = this.zsets.get(key);
      if (zset === undefined || zset.size === 0) return [];
      const oldest = [...zset.entries()].toSorted((a, b) => a[1] - b[1])[0]!;
      return [oldest[0], String(oldest[1])];
    }
    throw new Error(`unexpected command ${command}`);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  close(): void {
    this.closed = true;
  }
}

describe("RedisRateLimitStore", (): void => {
  it("считает хиты ключа в окне, member уникальны даже при одном now", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    const first = await store.record("ip:1.2.3.4", 1_000, 10, 500);
    const second = await store.record("ip:1.2.3.4", 1_000, 10, 500);

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.oldestAt).toBeNull();
  });

  it("prune выбрасывает хиты старше окна", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.2.3.4", 1_000, 10, 0);
    const result = await store.record("ip:1.2.3.4", 1_000, 10, 1_500);

    expect(result.count).toBe(1);
  });

  it("при превышении max достаёт время самого старого хита", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.2.3.4", 1_000, 2, 0);
    await store.record("ip:1.2.3.4", 1_000, 2, 100);
    const result = await store.record("ip:1.2.3.4", 1_000, 2, 200);

    expect(result.count).toBe(3);
    expect(result.oldestAt).toBe(0);
  });

  it("до превышения max ZRANGE не вызывается", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.2.3.4", 1_000, 5, 0);

    expect(client.commands).not.toContain("ZRANGE");
  });

  it("ставит TTL на ключ zset", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.2.3.4", 60_000, 10, 0);

    expect(client.pexpires[0]).toEqual({ key: "ip:1.2.3.4", ms: 60_000 });
  });

  it("ключи изолированы префиксом стора", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client, "limacina:test:rate-limit:");

    await store.record("ip:1.2.3.4", 1_000, 10, 0);

    expect(client.zsets.has("limacina:test:rate-limit:ip:1.2.3.4")).toBe(true);
    expect(client.zsets.has("ip:1.2.3.4")).toBe(false);
  });

  it("разные ключи — разные zset", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.1.1.1", 1_000, 10, 0);
    await store.record("ip:2.2.2.2", 1_000, 10, 0);
    const first = await store.record("ip:1.1.1.1", 1_000, 10, 0);

    expect(first.count).toBe(2);
  });

  it("сбой Redis — fail-open: хит не бросает и возвращает пустой результат", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);
    client.failMode = true;

    const result = await store.record("ip:1.2.3.4", 1_000, 10, 0);

    expect(result).toEqual({ count: 0, oldestAt: null });
  });
});

describe("RedisRateLimitStore — переподключение", (): void => {
  it("onclose планирует connect, close() отменяет", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client, "", 10);
    client.onclose?.(new Error("connection lost"));

    await Bun.sleep(30);
    expect(client.connectCalls).toBeGreaterThanOrEqual(1);

    store.close();
    const callsAfterClose = client.connectCalls;
    client.onclose?.(new Error("closed"));
    await Bun.sleep(30);
    expect(client.connectCalls).toBe(callsAfterClose);
    expect(client.closed).toBe(true);
  });
});
