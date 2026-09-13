import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { LogsService } from "./logs.service";
import { LauncherUpdateService } from "./launcher-update.service";
import { ConfigUpdateService } from "./config-update.service";
import { AdminMapStore, AdminMapStoreToken } from "./admin.store";
import { AdminPostgresStore } from "./admin_postgres.store";
import { AuthStoreModule } from "../auth/service/auth_store.module";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import { CronModule } from "../cron/cron.module";
import { isSqlDriver, type AppConfigType } from "../config/global-config";

const useFactory = (db: string) => {
  if (isSqlDriver(db)) {
    return new AdminPostgresStore();
  }
  return new AdminMapStore();
};

@Module({
  imports: [AppConfigModule, AuthStoreModule, CronModule],
  providers: [
    AdminService,
    LogsService,
    LauncherUpdateService,
    ConfigUpdateService,
    {
      provide: AdminMapStoreToken,
      useFactory: (config: AppConfigType) => useFactory(config.DB_DRIVER),
      inject: [AppConfigToken],
    },
  ],
  exports: [
    AdminService,
    LogsService,
    LauncherUpdateService,
    ConfigUpdateService,
    AdminMapStoreToken,
  ],
})
export class AdminModule {}
