import { Body, Controller, Get, Post } from "@nestjs/common";
import { FileDto } from "./dto/dto";
import { ApiOkResponse, ApiResponse } from "@nestjs/swagger";
import { FilesService } from "./files.service";

@Controller("files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get("list")
  @ApiResponse({ status: 201, description: "Текущий список файлов" })
  getList(): Record<string, string> {
    return this.filesService.getList();
  }

  @Post("files")
  @ApiOkResponse({
    description: "Файл по указаному урлу",
  })
  postFile(@Body() fileInfo: FileDto): Response {
    return this.filesService.postFile(fileInfo);
  }
}
