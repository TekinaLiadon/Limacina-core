import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { LogsService } from "./logs.service";
import { LauncherUpdateService } from "./launcher-update.service";
import { ConfigUpdateService } from "./config-update.service";
import { AdminMapStore, AdminMapStoreToken } from "./admin.store";
import { AdminPostgresStore } from "./admin_postgres.store";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";

const useFactory = (db: string) => {
  return (
    {
      postgres: new AdminPostgresStore(),
    }[db] ?? new AdminMapStore()
  );
};

@Module({
  imports: [AppConfigModule],
  controllers: [AdminController],
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
