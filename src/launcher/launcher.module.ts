import { Module } from "@nestjs/common";
import { LauncherService } from "./launcher.service";
import { LauncherReleasesService } from "./launcher-releases.service";
import { ReleasePublishService } from "./release-publish.service";
import { ConfigUpdateService } from "./config-update.service";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AppConfigModule],
  providers: [LauncherService, LauncherReleasesService, ReleasePublishService, ConfigUpdateService],
  exports: [LauncherService, LauncherReleasesService, ReleasePublishService, ConfigUpdateService],
})
export class LauncherModule {}
