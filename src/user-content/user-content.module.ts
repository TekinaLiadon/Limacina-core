import { Module } from "@nestjs/common";
import { UserContentService } from "./user-content.service";
import {
  UserContentMapStore,
  UserContentStoreToken,
  UserContentPostgresStore,
  type IUserContentStore,
} from "./user_content_store";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import { createStoreByDriver, type AppConfigType } from "../config/global-config";
import { YggdrasilProfileStoreModule } from "../yggdrasil/service/yggdrasil_store.module";

@Module({
  imports: [AppConfigModule, YggdrasilProfileStoreModule],
  providers: [
    UserContentService,
    {
      provide: UserContentStoreToken,
      useFactory: (config: AppConfigType) =>
        createStoreByDriver<IUserContentStore>(config.DB_DRIVER, {
          sql: () => new UserContentPostgresStore(),
          map: () => new UserContentMapStore(),
        }),
      inject: [AppConfigToken],
    },
  ],
  exports: [UserContentService, UserContentStoreToken],
})
export class UserContentModule {}
