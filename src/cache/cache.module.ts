import { Module } from "@nestjs/common";
import { RedisClient } from "bun";
import { CacheStoreToken, type ICacheStore } from "./cache.store";
import { RedisCacheStore } from "./redis.store";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { MemoryModule } from "../memory/memory.module";
import { MemoryDb } from "../memory/memory-db";
import { CacheMapStore } from "../memory/cache-map.store";

export const buildCachePrefix = (config: AppConfigType): string =>
  config.CACHE_PREFIX ?? `limacina:${config.NODE_ENV}`;

export const createCacheStore = (config: AppConfigType, db: MemoryDb): ICacheStore => {
  if (config.REDIS_URL) {
    return new RedisCacheStore(
      new RedisClient(config.REDIS_URL, { enableOfflineQueue: false }),
      buildCachePrefix(config),
    );
  }
  return new CacheMapStore(db);
};

@Module({
  imports: [AppConfigModule, MemoryModule],
  providers: [
    {
      provide: CacheStoreToken,
      useFactory: (config: AppConfigType, db: MemoryDb) => createCacheStore(config, db),
      inject: [AppConfigToken, MemoryDb],
    },
  ],
  exports: [CacheStoreToken],
})
export class CacheModule {}
