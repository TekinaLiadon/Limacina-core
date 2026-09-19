import { Module } from "@nestjs/common";
import { RconService, RconClientToken, createRconClient } from "./rcon.service";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [AppConfigModule, CacheModule],
  providers: [
    RconService,
    {
      provide: RconClientToken,
      useFactory: (config: AppConfigType) => createRconClient(config),
      inject: [AppConfigToken],
    },
  ],
  exports: [RconService],
})
export class RconModule {}
