import { Module } from "@nestjs/common";
import { LauncherController } from "./launcher.controller";
import { LauncherService } from "./launcher.service";

@Module({
  controllers: [LauncherController],
  providers: [LauncherService],
  exports: [LauncherService],
})
export class LauncherModule {}
