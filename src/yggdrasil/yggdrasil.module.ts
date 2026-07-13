import { Module } from "@nestjs/common";
import { YggdrasilController } from "./yggdrasil.controller";
import { YggdrasilService } from "./service/yggdrasil.service";
import {
  YggdrasilMapStore,
  YggdrasilMapSessionStore,
  YggdrasilMapTokenStore,
  YggdrasilStoreToken,
  YggdrasilSessionStoreToken,
  YggdrasilTokenStoreToken,
} from "./service/yggdrasil_store";
import { YggdrasilPostgresStore } from "./service/yggdrasil_postgres";
import { YggdrasilProxyStore } from "./service/yggdrasil_proxy";
import { UserContentModule } from "../user-content/user-content.module";
import GlobalConfig from "../config/global-config";

const config = GlobalConfig.parseEnvOrExit();

export const useProfileStore = (db: string, proxyUrl?: string) => {
  if (proxyUrl) {
    return new YggdrasilProxyStore(proxyUrl);
  }

  if (db === "postgres") {
    return new YggdrasilPostgresStore();
  }

  return new YggdrasilMapStore();
};

export const useTokenStore = () => new YggdrasilMapTokenStore();
export const useSessionStore = () => new YggdrasilMapSessionStore();

@Module({
  imports: [UserContentModule],
  controllers: [YggdrasilController],
  providers: [
    YggdrasilService,
    {
      provide: YggdrasilStoreToken,
      useFactory: () => useProfileStore(config.DB_DRIVER, config.YGGDRASIL_PROXY_URL),
    },
    {
      provide: YggdrasilTokenStoreToken,
      useFactory: useTokenStore,
    },
    {
      provide: YggdrasilSessionStoreToken,
      useFactory: useSessionStore,
    },
  ],
  exports: [YggdrasilService],
})
export class YggdrasilModule {}
