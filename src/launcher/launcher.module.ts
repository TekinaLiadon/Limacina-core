import { Module } from "@nestjs/common";
import { LauncherService } from "./launcher.service";
import { LauncherReleasesService } from "./launcher-releases.service";
import { LauncherUpdateService } from "./launcher-update.service";
import { ReleasePublishService } from "./release-publish.service";
import { ConfigUpdateService } from "./config-update.service";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AppConfigModule],
  providers: [
    LauncherService,
    LauncherReleasesService,
    LauncherUpdateService,
    ReleasePublishService,
    ConfigUpdateService,
  ],
  exports: [
    LauncherService,
    LauncherReleasesService,
    LauncherUpdateService,
    ReleasePublishService,
    ConfigUpdateService,
  ],
})
export class LauncherModule {}
