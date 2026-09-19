import { FilesService } from "./files.service";
import { StartupSweepService } from "./startup-sweep.service";
import { Module } from "@nestjs/common";

@Module({
  providers: [FilesService, StartupSweepService],
  exports: [FilesService],
})
export class FilesModule {}
