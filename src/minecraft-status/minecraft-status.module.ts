import { Module } from "@nestjs/common";
import { MinecraftStatusService } from "./minecraft-status.service";
import { AppConfigModule } from "../config/app-config.provider";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [AppConfigModule, CacheModule],
  providers: [MinecraftStatusService],
  exports: [MinecraftStatusService],
})
export class MinecraftStatusModule {}
