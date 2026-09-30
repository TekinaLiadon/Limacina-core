import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  RedisClientLifecycle,
  REDIS_RECONNECT_DELAY_MS,
  type RedisLifecycleClient,
} from "../utils/redis-lifecycle";
import {
  DEFAULT_CACHE_TTL_MS,
  assertValidCacheTtl,
  parseCacheValue,
  serializeCacheValue,
  type ICacheStore,
} from "./cache_store";

export interface RedisClientLike extends RedisLifecycleClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", milliseconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

@Injectable()
export class RedisCacheStore implements ICacheStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheStore.name);
  private readonly lifecycle: RedisClientLifecycle;

  constructor(
    private readonly client: RedisClientLike,
    private readonly keyPrefix: string = "",
    reconnectDelayMs: number = REDIS_RECONNECT_DELAY_MS,
  ) {
    this.lifecycle = new RedisClientLifecycle(
      client,
      this.logger,
      {
        onclose: "Redis отключился, запланировано переподключение",
        onconnect: "Redis подключен",
        recovered: "Redis снова отвечает, кеш восстановлен",
        failure: "Команда Redis не выполнена, промах кеша",
      },
      reconnectDelayMs,
    );
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    let raw: string | null;
    try {
      raw = await this.lifecycle.withTimeout(this.client.get(this.buildKey(key)), "get");
    } catch (error) {
      this.lifecycle.reportFailure(error, { key, action: "get" });
      return undefined;
    }

    this.lifecycle.reportSuccess();
    if (raw === null) return undefined;

    return parseCacheValue<T>(
      this.logger,
      key,
      raw,
      "Повреждённое значение в кеш-сторе, промах кеша",
    );
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    if (!assertValidCacheTtl(this.logger, key, ttlMs)) return;

    const payload = serializeCacheValue(this.logger, key, value);
    if (payload === undefined) return;

    try {
      await this.lifecycle.withTimeout(
        this.client.set(this.buildKey(key), payload, "PX", ttlMs ?? DEFAULT_CACHE_TTL_MS),
        "set",
      );
      this.lifecycle.reportSuccess();
    } catch (error) {
      this.lifecycle.reportFailure(error, { key, action: "set" });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.lifecycle.withTimeout(this.client.del(this.buildKey(key)), "delete");
      this.lifecycle.reportSuccess();
    } catch (error) {
      this.lifecycle.reportFailure(error, { key, action: "delete" });
    }
  }

  onModuleDestroy(): void {
    this.lifecycle.dispose();
  }

  private buildKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }
}
