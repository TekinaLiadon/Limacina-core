import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { DEFAULT_CACHE_TTL_MS, type ICacheStore } from "./cache.store";

export const COMMAND_TIMEOUT_MS = 500;
const FAILURE_LOG_INTERVAL = 100;
const RECONNECT_DELAY_MS = 5_000;

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", milliseconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  close(): void;
  connect?(): Promise<void>;
  onconnect?: (() => void) | null;
  onclose?: ((error: Error) => void) | null;
}

@Injectable()
export class RedisCacheStore implements ICacheStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheStore.name);
  private consecutiveFailures = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: RedisClientLike,
    private readonly keyPrefix: string = "",
    private readonly reconnectDelayMs: number = RECONNECT_DELAY_MS,
  ) {
    this.client.onclose = (error: Error) => {
      this.logger.error({ err: error }, "Redis отключился, запланировано переподключение");
      this.scheduleReconnect();
    };
    this.client.onconnect = () => {
      this.clearReconnectTimer();
      this.logger.log("Redis подключен");
    };
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    let raw: string | null;
    try {
      raw = await this.withTimeout(this.client.get(this.buildKey(key)), "get");
    } catch (error) {
      this.reportFailure(error, "get", key);
      return undefined;
    }

    this.reportSuccess();
    if (raw === null) return undefined;

    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.error({ key }, "Повреждённое значение в кеш-сторе, промах кеша");
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      await this.withTimeout(
        this.client.set(this.buildKey(key), payload, "PX", ttlMs ?? DEFAULT_CACHE_TTL_MS),
        "set",
      );
      this.reportSuccess();
    } catch (error) {
      this.reportFailure(error, "set", key);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.withTimeout(this.client.del(this.buildKey(key)), "delete");
      this.reportSuccess();
    } catch (error) {
      this.reportFailure(error, "delete", key);
    }
  }

  onModuleDestroy(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.client.close();
  }

  private buildKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
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
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private reportSuccess(): void {
    if (this.consecutiveFailures === 0) return;

    this.logger.log(
      { skippedFailures: this.consecutiveFailures },
      "Redis снова отвечает, кеш восстановлен",
    );
    this.consecutiveFailures = 0;
  }

  private reportFailure(error: unknown, action: string, key: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures !== 1 && this.consecutiveFailures % FAILURE_LOG_INTERVAL !== 0) {
      return;
    }

    this.logger.error(
      { err: error, key, action, consecutiveFailures: this.consecutiveFailures },
      "Команда Redis не выполнена, промах кеша",
    );
  }
}
