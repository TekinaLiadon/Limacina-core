import { Module } from "@nestjs/common";
import { LauncherService } from "./launcher.service";
import { LauncherReleasesService } from "./launcher-releases.service";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AppConfigModule],
  providers: [LauncherService, LauncherReleasesService],
  exports: [LauncherService, LauncherReleasesService],
})
export class LauncherModule {}
