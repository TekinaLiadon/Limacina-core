import { FilesService } from "./files.service";
import { ModsService } from "./mods.service";
import { StartupSweepService } from "./startup-sweep.service";
import { Module } from "@nestjs/common";
import { CacheModule } from "../cache/cache.module";

@Module({
  imports: [CacheModule],
  providers: [FilesService, ModsService, StartupSweepService],
  exports: [FilesService, ModsService],
})
export class FilesModule {}
