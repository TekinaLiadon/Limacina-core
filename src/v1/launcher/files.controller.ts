import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/public.decorator";
import { FileDto } from "../../files/dto/dto";
import { FilesService } from "../../files/files.service";

@ApiTags("launcher_files")
@Public()
@Controller("v1/launcher/files")
export class V1LauncherFilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get("list")
  @ApiOperation({ summary: "Получить список файлов лаунчера" })
  @ApiResponse({ status: 200, description: "Текущий список файлов лаунчера" })
  getList(): Record<string, string> {
    return this.filesService.getList();
  }

  @Get("mods")
  @ApiOperation({ summary: "Получить список модов" })
  @ApiResponse({ status: 200, description: "Текущий список модов" })
  getModsList(): Record<string, string> {
    return this.filesService.getExtraList("mods");
  }

  @Post("download")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Скачать файл лаунчера по пути" })
  @ApiResponse({ status: 200, description: "Файл по указаному урлу" })
  async postFile(@Body() fileInfo: FileDto, @Res() reply: FastifyReply): Promise<void> {
    return this.filesService.postFile(fileInfo, reply);
  }
}
