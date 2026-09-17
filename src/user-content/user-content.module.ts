import { Module } from "@nestjs/common";
import { UserContentService } from "./user-content.service";
import {
  UserContentMapStore,
  UserContentStoreToken,
  UserContentPostgresStore,
} from "./user_content_store";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import { isSqlDriver, type AppConfigType } from "../config/global-config";
import { YggdrasilProfileStoreModule } from "../yggdrasil/service/yggdrasil_store.module";

const useFactory = (db: string) => {
  if (isSqlDriver(db)) {
    return new UserContentPostgresStore();
  }
  return new UserContentMapStore();
};

@Module({
  imports: [AppConfigModule, YggdrasilProfileStoreModule],
  providers: [
    UserContentService,
    {
      provide: UserContentStoreToken,
      useFactory: (config: AppConfigType) => useFactory(config.DB_DRIVER),
      inject: [AppConfigToken],
    },
  ],
  exports: [UserContentService, UserContentStoreToken],
})
export class UserContentModule {}
