import { Module } from "@nestjs/common";
import { AppConfigModule, AppConfigToken } from "../../config/app-config.provider";
import { isSqlDriver, type AppConfigType } from "../../config/global-config";
import { MemoryDb } from "../../memory/memory-db";
import { MemoryModule } from "../../memory/memory.module";
import { YggdrasilMapStore, YggdrasilStoreToken } from "./yggdrasil_store";
import { YggdrasilPostgresStore } from "./yggdrasil_postgres_store";

const useFactory = (db: string, memoryDb: MemoryDb) => {
  if (isSqlDriver(db)) {
    return new YggdrasilPostgresStore();
  }
  return new YggdrasilMapStore(memoryDb);
};

@Module({
  imports: [AppConfigModule, MemoryModule],
  providers: [
    {
      provide: YggdrasilStoreToken,
      useFactory: (config: AppConfigType, memoryDb: MemoryDb) =>
        useFactory(config.DB_DRIVER, memoryDb),
      inject: [AppConfigToken, MemoryDb],
    },
  ],
  exports: [YggdrasilStoreToken],
})
export class YggdrasilProfileStoreModule {}
