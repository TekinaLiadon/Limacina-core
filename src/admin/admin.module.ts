import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { LogsService } from "./logs.service";
import { LauncherUpdateService } from "./launcher-update.service";
import { ConfigUpdateService } from "./config-update.service";
import { AdminMapStore, AdminMapStoreToken } from "./admin.store";
import { AdminPostgresStore } from "./admin_postgres.store";
import GlobalConfig from "../config/global-config";

const config = GlobalConfig.parseEnvOrExit();

const useFactory = (db: string) => {
  return (
    {
      postgres: new AdminPostgresStore(),
    }[db] ?? new AdminMapStore()
  );
};

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    LogsService,
    LauncherUpdateService,
    ConfigUpdateService,
    {
      provide: AdminMapStoreToken,
      useFactory: () => useFactory(config.DB_DRIVER),
    },
  ],
  exports: [AdminMapStoreToken],
})
export class AdminModule {}
