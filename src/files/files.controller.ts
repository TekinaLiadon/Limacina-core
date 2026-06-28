import { Body, Controller, Get, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Public } from "../common/public.decorator";
import { FileDto } from "./dto/dto";
import { ApiOkResponse, ApiResponse } from "@nestjs/swagger";
import { FilesService } from "./files.service";

@Public()
@Controller("files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get("list")
  @ApiResponse({ status: 201, description: "Текущий список файлов лаунчера" })
  getList(): Record<string, string> {
    return this.filesService.getList();
  }

  @Get("mods")
  @ApiResponse({ status: 201, description: "Текущий список модов" })
  getModsList(): Record<string, string> {
    return this.filesService.getExtraList("mods");
  }

  @Post("files")
  @ApiOkResponse({
    description: "Файл по указаному урлу",
  })
  async postFile(@Body() fileInfo: FileDto, @Res() reply: FastifyReply): Promise<void> {
    return this.filesService.postFile(fileInfo, reply);
  }
}
