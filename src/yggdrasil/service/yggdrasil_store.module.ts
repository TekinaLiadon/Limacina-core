import { Module } from "@nestjs/common";
import { AppConfigModule, AppConfigToken } from "../../config/app-config.provider";
import { createStoreByDriver, type AppConfigType } from "../../config/global-config";
import { MemoryDb } from "../../memory/memory-db";
import { MemoryModule } from "../../memory/memory.module";
import { YggdrasilMapStore, YggdrasilStoreToken, type IYggdrasilStore } from "./yggdrasil_store";
import { YggdrasilPostgresStore } from "./yggdrasil_postgres_store";

@Module({
  imports: [AppConfigModule, MemoryModule],
  providers: [
    {
      provide: YggdrasilStoreToken,
      useFactory: (config: AppConfigType, memoryDb: MemoryDb) =>
        createStoreByDriver<IYggdrasilStore>(config.DB_DRIVER, {
          sql: () => new YggdrasilPostgresStore(),
          map: () => new YggdrasilMapStore(memoryDb),
        }),
      inject: [AppConfigToken, MemoryDb],
    },
  ],
  exports: [YggdrasilStoreToken],
})
export class YggdrasilProfileStoreModule {}
