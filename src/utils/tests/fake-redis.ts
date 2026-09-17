import type { RedisClientLike } from "../../cache/redis_store";

export class FakeRedisClient implements RedisClientLike {
  readonly stored = new Map<string, string>();
  lastSet: { key: string; value: string; px: "PX"; milliseconds: number } | null = null;
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
