import { describe, expect, it } from "bun:test";
import { RedisRateLimitStore, type RateLimitRedisClientLike } from "../rate-limit-redis-store";

class FakeZsetRedis implements RateLimitRedisClientLike {
  readonly zsets = new Map<string, Map<string, number>>();
  readonly commands: string[] = [];
  readonly evalArgs: string[][] = [];
  readonly pexpires: { key: string; ms: number }[] = [];
  failMode = false;
  badReply = false;
  closed = false;
  connectCalls = 0;
  onclose: ((error: Error) => void) | null = null;
  onconnect: (() => void) | null = null;

  async send(command: string, args: string[]): Promise<unknown> {
    this.commands.push(command);
    if (this.failMode) throw new Error("redis unavailable");

    if (command === "EVAL") {
      this.evalArgs.push(args);
      if (this.badReply) return "unexpected reply";
      return this.evalSlidingWindow(args);
    }
    throw new Error(`unexpected command ${command}`);
  }

  private evalSlidingWindow(args: string[]): unknown {
    const key = args[2]!;
    const now = Number(args[3]);
    const windowMs = Number(args[4]);
    const max = Number(args[5]);
    const member = args[6]!;
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    zset.set(member, now);
    this.zsets.set(key, zset);
    for (const [hitMember, score] of zset) {
      if (score <= now - windowMs) zset.delete(hitMember);
    }
    this.pexpires.push({ key, ms: windowMs });
    const count = zset.size;
    if (count <= max) return [count, -1];
    const oldest = [...zset.entries()].toSorted((a, b) => a[1] - b[1])[0];
    return [count, oldest?.[1] ?? -1];
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  close(): void {
    this.closed = true;
  }
}

describe("RedisRateLimitStore", (): void => {
  it("record шлёт ровно один EVAL: окно и oldestAt за один RTT", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.2.3.4", 1_000, 1, 0);
    const overLimit = await store.record("ip:1.2.3.4", 1_000, 1, 100);

    expect(client.commands).toEqual(["EVAL", "EVAL"]);
    const [script, numKeys, key, nowArg, windowArg, maxArg, member] = client.evalArgs[1]!;
    expect(script).toContain("ZADD");
    expect(script).toContain("ZREMRANGEBYSCORE");
    expect(script).toContain("ZCARD");
    expect(script).toContain("PEXPIRE");
    expect(script).toContain("ZRANGE");
    expect(numKeys).toBe("1");
    expect(key).toBe("ip:1.2.3.4");
    expect(nowArg).toBe("100");
    expect(windowArg).toBe("1000");
    expect(maxArg).toBe("1");
    expect(member).toMatch(/^100:/);
    expect(overLimit.count).toBe(2);
    expect(overLimit.oldestAt).toBe(0);
  });

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

  it("до превышения max oldestAt не возвращается", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);

    await store.record("ip:1.2.3.4", 1_000, 5, 0);
    await store.record("ip:1.2.3.4", 1_000, 5, 100);

    const result = await store.record("ip:1.2.3.4", 1_000, 5, 200);
    expect(result.count).toBe(3);
    expect(result.oldestAt).toBeNull();
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
    expect(client.evalArgs[0]?.[2]).toBe("limacina:test:rate-limit:ip:1.2.3.4");
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

  it("битый ответ Redis — fail-open: хит не бросает и возвращает пустой результат", async (): Promise<void> => {
    const client = new FakeZsetRedis();
    const store = new RedisRateLimitStore(client);
    client.badReply = true;

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
