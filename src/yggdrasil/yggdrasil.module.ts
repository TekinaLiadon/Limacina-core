import { Module } from "@nestjs/common";
import { YggdrasilController } from "./yggdrasil.controller";
import { YggdrasilService } from "./service/yggdrasil.service";
import {
  YggdrasilMapStore,
  YggdrasilStoreToken,
  YggdrasilSessionStoreToken,
  YggdrasilTokenStoreToken,
} from "./service/yggdrasil_store";
import { YggdrasilMapSessionStore, YggdrasilMapTokenStore } from "../memory/yggdrasil-map.store";
import { MemoryModule } from "../memory/memory.module";
import { MemoryDb } from "../memory/memory-db";
import { YggdrasilPostgresStore } from "./service/yggdrasil_postgres";
import { UserContentModule } from "../user-content/user-content.module";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";

export const useProfileStore = (db: string) => {
  if (db === "postgres") {
    return new YggdrasilPostgresStore();
  }

  return new YggdrasilMapStore();
};

@Module({
  imports: [AppConfigModule, UserContentModule, MemoryModule],
  controllers: [YggdrasilController],
  providers: [
    YggdrasilService,
    {
      provide: YggdrasilStoreToken,
      useFactory: (config: AppConfigType) => useProfileStore(config.DB_DRIVER),
      inject: [AppConfigToken],
    },
    {
      provide: YggdrasilTokenStoreToken,
      useFactory: (db: MemoryDb) => new YggdrasilMapTokenStore(db),
      inject: [MemoryDb],
    },
    {
      provide: YggdrasilSessionStoreToken,
      useFactory: (db: MemoryDb) => new YggdrasilMapSessionStore(db),
      inject: [MemoryDb],
    },
  ],
  exports: [YggdrasilService],
})
export class YggdrasilModule {}
