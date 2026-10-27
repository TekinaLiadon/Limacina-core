import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  RedisClientLifecycle,
  REDIS_RECONNECT_DELAY_MS,
  type RedisLifecycleClient,
} from "../utils/redis-lifecycle";
import type { SlidingWindowResult, SlidingWindowStore } from "./sliding-window-rate-limiter";

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZADD', key, now, member)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
redis.call('PEXPIRE', key, windowMs)
local oldestAt = -1
if count > max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] then
    oldestAt = tonumber(oldest[2])
  end
end
return {count, oldestAt}
`;

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
      const reply = await this.lifecycle.withTimeout(
        this.client.send("EVAL", [
          SLIDING_WINDOW_SCRIPT,
          "1",
          zsetKey,
          String(nowMs),
          String(windowMs),
          String(max),
          `${nowMs}:${randomUUID()}`,
        ]),
        "EVAL",
      );
      this.lifecycle.reportSuccess();
      return parseSlidingWindowReply(reply);
    } catch (error) {
      this.lifecycle.reportFailure(error, { key: zsetKey });
      return { count: 0, oldestAt: null };
    }
  }
}

function parseSlidingWindowReply(reply: unknown): SlidingWindowResult {
  if (!Array.isArray(reply) || reply.length !== 2) {
    throw new Error("Неожиданный ответ Redis на EVAL sliding window");
  }

  const count = Number(reply[0]);
  const oldestScore = Number(reply[1]);
  return { count, oldestAt: oldestScore >= 0 ? oldestScore : null };
}
