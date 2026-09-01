import { Module } from "@nestjs/common";
import { AppConfigModule, AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import { useFactory } from "./auth.service";
import { AuthMapStoreToken } from "./auth_store.service";

@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: AuthMapStoreToken,
      useFactory: (config: AppConfigType) => useFactory(config.DB_DRIVER),
      inject: [AppConfigToken],
    },
  ],
  exports: [AuthMapStoreToken],
})
export class AuthStoreModule {}
