import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/public.decorator";
import {
  FileDto,
  fileListResponseSchema,
  FileListResponseDto,
  FilesListQueryDto,
} from "../../files/dto/dto";
import { FilesService } from "../../files/files.service";

const TOTAL_COUNT_HEADER = {
  description: "Общее число записей по фильтру (для пагинации)",
  schema: { type: "integer" },
} as const;

@ApiTags("launcher_files")
@Public()
@Controller("v1/launcher/files")
export class V1LauncherFilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get("list")
  @ApiOperation({
    summary: "Получить список файлов лаунчера",
    description:
      "Возвращает карту «путь → SHA-1 хеш» без папки mods. Сортировка по пути, пагинация опциональна: " +
      "без limit/offset отдаётся весь список; заголовок X-Total-Count содержит общее число записей.",
  })
  @ApiQuery({ name: "offset", required: false, example: 0, description: "Смещение от начала" })
  @ApiQuery({ name: "limit", required: false, example: 100, description: "Записей в ответе" })
  @ApiResponse({
    status: 200,
    description: "Текущий список файлов лаунчера",
    schema: fileListResponseSchema,
    headers: { "x-total-count": TOTAL_COUNT_HEADER },
  })
  getList(
    @Query() query: FilesListQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): FileListResponseDto {
    const page = this.filesService.getList(query.offset, query.limit);
    reply.header("X-Total-Count", page.total);
    return page.files;
  }

  @Get("mods")
  @ApiOperation({
    summary: "Получить список модов",
    description:
      "Возвращает карту «путь → SHA-1 хеш» для папки mods. Пагинация опциональна, " +
      "заголовок X-Total-Count содержит общее число записей.",
  })
  @ApiQuery({ name: "offset", required: false, example: 0, description: "Смещение от начала" })
  @ApiQuery({ name: "limit", required: false, example: 100, description: "Записей в ответе" })
  @ApiResponse({
    status: 200,
    description: "Текущий список модов",
    schema: fileListResponseSchema,
    headers: { "x-total-count": TOTAL_COUNT_HEADER },
  })
  getModsList(
    @Query() query: FilesListQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): FileListResponseDto {
    const page = this.filesService.getExtraList("mods", query.offset, query.limit);
    reply.header("X-Total-Count", page.total);
    return page.files;
  }

  @Post("download")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Скачать файл лаунчера по пути" })
  @ApiResponse({ status: 200, description: "Файл по указаному урлу" })
  async sendFile(@Body() fileInfo: FileDto, @Res() reply: FastifyReply): Promise<void> {
    return this.filesService.sendFile(fileInfo, reply);
  }
}
