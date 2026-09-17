import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { SlidingWindowResult, SlidingWindowStore } from "./sliding-window-rate-limiter";

const COMMAND_TIMEOUT_MS = 500;
const FAILURE_LOG_INTERVAL = 100;
const RECONNECT_DELAY_MS = 5_000;

export interface RateLimitRedisClientLike {
  send(command: string, args: string[]): Promise<unknown>;
  connect?(): Promise<void>;
  close(): void;
  onconnect?: (() => void) | null;
  onclose?: ((error: Error) => void) | null;
}

export class RedisRateLimitStore implements SlidingWindowStore {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private consecutiveFailures = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: RateLimitRedisClientLike,
    private readonly keyPrefix = "",
    private readonly reconnectDelayMs = RECONNECT_DELAY_MS,
  ) {
    this.client.onclose = (error: Error): void => {
      this.logger.error({ err: error }, "Redis отключился, rate limit работает в режиме fail-open");
      this.scheduleReconnect();
    };
    this.client.onconnect = (): void => {
      this.clearReconnectTimer();
      this.logger.log("Redis подключен, rate limit снова на Redis");
    };
  }

  close(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.client.close();
  }

  async record(
    key: string,
    windowMs: number,
    max: number,
    nowMs: number,
  ): Promise<SlidingWindowResult> {
    const zsetKey = `${this.keyPrefix}${key}`;
    try {
      await this.withTimeout(
        this.client.send("ZADD", [zsetKey, String(nowMs), `${nowMs}:${randomUUID()}`]),
        "ZADD",
      );
      await this.withTimeout(
        this.client.send("ZREMRANGEBYSCORE", [zsetKey, "-inf", String(nowMs - windowMs)]),
        "ZREMRANGEBYSCORE",
      );
      const count = Number(await this.withTimeout(this.client.send("ZCARD", [zsetKey]), "ZCARD"));
      await this.withTimeout(this.client.send("PEXPIRE", [zsetKey, String(windowMs)]), "PEXPIRE");
      this.reportSuccess();

      const oldestAt = count > max ? await this.oldestAt(zsetKey) : null;
      return { count, oldestAt };
    } catch (error) {
      this.reportFailure(error, zsetKey);
      return { count: 0, oldestAt: null };
    }
  }

  private async oldestAt(zsetKey: string): Promise<number | null> {
    const range = (await this.withTimeout(
      this.client.send("ZRANGE", [zsetKey, "0", "0", "WITHSCORES"]),
      "ZRANGE",
    )) as unknown;
    if (!Array.isArray(range) || range.length < 2) return null;
    const score = Number(range[1]);
    return Number.isFinite(score) ? score : null;
  }

  private scheduleReconnect(): void {
    const { connect } = this.client;
    if (this.closed || this.reconnectTimer !== undefined || !connect) return;

    const reconnect = connect.bind(this.client);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      reconnect().catch((error: unknown) => {
        this.logger.error({ err: error }, "Переподключение к Redis не удалось");
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private async withTimeout<T>(operation: Promise<T>, action: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiration = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Redis ${action} не ответил за ${COMMAND_TIMEOUT_MS} мс`)),
        COMMAND_TIMEOUT_MS,
      );
    });

    try {
      return await Promise.race([operation, expiration]);
    } catch (error) {
      operation.catch(() => {});
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private reportSuccess(): void {
    if (this.consecutiveFailures === 0) return;

    this.logger.log(
      { skippedFailures: this.consecutiveFailures },
      "Redis снова отвечает, rate limit восстановлен",
    );
    this.consecutiveFailures = 0;
  }

  private reportFailure(error: unknown, key: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures !== 1 && this.consecutiveFailures % FAILURE_LOG_INTERVAL !== 0) {
      return;
    }

    this.logger.error(
      { err: error, key, consecutiveFailures: this.consecutiveFailures },
      "Команда Redis не выполнена, запрос пропущен без лимита (fail-open)",
    );
  }
}
