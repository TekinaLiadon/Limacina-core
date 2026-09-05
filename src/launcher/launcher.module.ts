import { Module } from "@nestjs/common";
import { LauncherService } from "./launcher.service";

@Module({
  providers: [LauncherService],
  exports: [LauncherService],
})
export class LauncherModule {}
