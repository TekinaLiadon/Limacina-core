import { Module } from "@nestjs/common";
import { UserContentController } from "./user-content.controller";
import { UserContentService } from "./user-content.service";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
  UserContentPostgresStore,
} from "./user-content.store";
import GlobalConfig from "../config/global-config";

const config = GlobalConfig.parseEnvOrExit();

const useFactory = (db: string) => {
  if (db === "postgres") {
    return new UserContentPostgresStore();
  }
  return new UserContentMapStore();
};

@Module({
  controllers: [UserContentController],
  providers: [
    UserContentService,
    {
      provide: UserContentMapStoreToken,
      useFactory: () => useFactory(config.DB_DRIVER),
    },
  ],
  exports: [UserContentMapStoreToken],
})
export class UserContentModule {}
