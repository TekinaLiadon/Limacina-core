import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { Module } from "@nestjs/common";

@Module({
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
