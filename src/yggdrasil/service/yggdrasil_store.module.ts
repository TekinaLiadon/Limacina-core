import { Module } from "@nestjs/common";
import { AppConfigModule, AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import { YggdrasilMapStore, YggdrasilStoreToken } from "./yggdrasil_store";
import { YggdrasilPostgresStore } from "./yggdrasil_postgres";

const useFactory = (db: string) => {
  if (db === "postgres") {
    return new YggdrasilPostgresStore();
  }
  return new YggdrasilMapStore();
};

@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: YggdrasilStoreToken,
      useFactory: (config: AppConfigType) => useFactory(config.DB_DRIVER),
      inject: [AppConfigToken],
    },
  ],
  exports: [YggdrasilStoreToken],
})
export class YggdrasilProfileStoreModule {}
