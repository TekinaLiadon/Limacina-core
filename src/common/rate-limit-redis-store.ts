import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  RedisClientLifecycle,
  REDIS_RECONNECT_DELAY_MS,
  type RedisLifecycleClient,
} from "../utils/redis-lifecycle";
import type { SlidingWindowResult, SlidingWindowStore } from "./sliding-window-rate-limiter";

export interface RateLimitRedisClientLike extends RedisLifecycleClient {
  send(command: string, args: string[]): Promise<unknown>;
}

export class RedisRateLimitStore implements SlidingWindowStore {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private readonly lifecycle: RedisClientLifecycle;

  constructor(
    private readonly client: RateLimitRedisClientLike,
    private readonly keyPrefix = "",
    reconnectDelayMs: number = REDIS_RECONNECT_DELAY_MS,
  ) {
    this.lifecycle = new RedisClientLifecycle(
      client,
      this.logger,
      {
        onclose: "Redis отключился, rate limit работает в режиме fail-open",
        onconnect: "Redis подключен, rate limit снова на Redis",
        recovered: "Redis снова отвечает, rate limit восстановлен",
        failure: "Команда Redis не выполнена, запрос пропущен без лимита (fail-open)",
      },
      reconnectDelayMs,
    );
  }

  close(): void {
    this.lifecycle.dispose();
  }

  async record(
    key: string,
    windowMs: number,
    max: number,
    nowMs: number,
  ): Promise<SlidingWindowResult> {
    const zsetKey = `${this.keyPrefix}${key}`;
    try {
      await this.lifecycle.withTimeout(
        this.client.send("ZADD", [zsetKey, String(nowMs), `${nowMs}:${randomUUID()}`]),
        "ZADD",
      );
      await this.lifecycle.withTimeout(
        this.client.send("ZREMRANGEBYSCORE", [zsetKey, "-inf", String(nowMs - windowMs)]),
        "ZREMRANGEBYSCORE",
      );
      const count = Number(
        await this.lifecycle.withTimeout(this.client.send("ZCARD", [zsetKey]), "ZCARD"),
      );
      await this.lifecycle.withTimeout(
        this.client.send("PEXPIRE", [zsetKey, String(windowMs)]),
        "PEXPIRE",
      );
      this.lifecycle.reportSuccess();

      const oldestAt = count > max ? await this.oldestAt(zsetKey) : null;
      return { count, oldestAt };
    } catch (error) {
      this.lifecycle.reportFailure(error, { key: zsetKey });
      return { count: 0, oldestAt: null };
    }
  }

  private async oldestAt(zsetKey: string): Promise<number | null> {
    const range = (await this.lifecycle.withTimeout(
      this.client.send("ZRANGE", [zsetKey, "0", "0", "WITHSCORES"]),
      "ZRANGE",
    )) as unknown;
    if (!Array.isArray(range) || range.length < 2) return null;
    const score = Number(range[1]);
    return Number.isFinite(score) ? score : null;
  }
}
