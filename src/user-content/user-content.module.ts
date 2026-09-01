import { Module } from "@nestjs/common";
import { UserContentController } from "./user-content.controller";
import { UserContentService } from "./user-content.service";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
  UserContentPostgresStore,
} from "./user-content.store";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";

const useFactory = (db: string) => {
  if (db === "postgres") {
    return new UserContentPostgresStore();
  }
  return new UserContentMapStore();
};

@Module({
  imports: [AppConfigModule],
  controllers: [UserContentController],
  providers: [
    UserContentService,
    {
      provide: UserContentMapStoreToken,
      useFactory: (config: AppConfigType) => useFactory(config.DB_DRIVER),
      inject: [AppConfigToken],
    },
  ],
  exports: [UserContentService, UserContentMapStoreToken],
})
export class UserContentModule {}
