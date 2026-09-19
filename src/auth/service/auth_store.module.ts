import { Module } from "@nestjs/common";
import { AppConfigModule, AppConfigToken } from "../../config/app-config.provider";
import { isSqlDriver, type AppConfigType } from "../../config/global-config";
import { MemoryDb } from "../../memory/memory-db";
import { MemoryModule } from "../../memory/memory.module";
import { AuthMapStore, AuthStoreToken, type IAuthStore } from "./auth_store";
import { AuthPostgresStore } from "./auth_postgres_store";
import { AuthProxyStore } from "./auth_proxy_store";

function createAuthStore(config: AppConfigType, db: MemoryDb): IAuthStore {
  if (config.AUTH_PROXY_URL) {
    return new AuthProxyStore(config.AUTH_PROXY_URL);
  }

  if (isSqlDriver(config.DB_DRIVER)) {
    return new AuthPostgresStore();
  }
  return new AuthMapStore(db);
}

@Module({
  imports: [AppConfigModule, MemoryModule],
  providers: [
    {
      provide: AuthStoreToken,
      useFactory: (config: AppConfigType, db: MemoryDb) => createAuthStore(config, db),
      inject: [AppConfigToken, MemoryDb],
    },
  ],
  exports: [AuthStoreToken],
})
export class AuthStoreModule {}
