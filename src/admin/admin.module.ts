import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { LogsService } from "./logs.service";
import { AdminMapStore, AdminMapStoreToken, type IAdminStore } from "./admin_store";
import { AdminPostgresStore } from "./admin_postgres_store";
import { AuthStoreModule } from "../auth/service/auth_store.module";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import { CronModule } from "../cron/cron.module";
import { MemoryDb } from "../memory/memory-db";
import { MemoryModule } from "../memory/memory.module";
import { createStoreByDriver, type AppConfigType } from "../config/global-config";

@Module({
  imports: [AppConfigModule, AuthStoreModule, CronModule, MemoryModule],
  providers: [
    AdminService,
    LogsService,
    {
      provide: AdminMapStoreToken,
      useFactory: (config: AppConfigType, memoryDb: MemoryDb) =>
        createStoreByDriver<IAdminStore>(config.DB_DRIVER, {
          sql: () => new AdminPostgresStore(),
          map: () => new AdminMapStore(memoryDb),
        }),
      inject: [AppConfigToken, MemoryDb],
    },
  ],
  exports: [AdminService, LogsService, AdminMapStoreToken],
})
export class AdminModule {}
