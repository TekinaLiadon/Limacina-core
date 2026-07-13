import { BadRequestException, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UserContentService } from "./user-content.service";
import { UserContentItemDto } from "./dto/dto";
import type { FastifyRequest } from "fastify";

@ApiTags("user-content")
@ApiBearerAuth()
@Controller("user-content")
export class UserContentController {
  constructor(private readonly userContentService: UserContentService) {}

  @Post("skins")
  @ApiOperation({ summary: "Загрузить скин (.png)" })
  @ApiResponse({ status: 201, type: UserContentItemDto })
  @ApiResponse({ status: 400, description: "Лимит загрузки скинов" })
  async uploadSkin(@Req() request: FastifyRequest): Promise<UserContentItemDto> {
    const userUuid = (request as FastifyRequest & { user: { uuid: string } }).user.uuid;
    const buffer = await this.extractFile(request);
    return this.userContentService.uploadSkin(userUuid, buffer);
  }

  @Get("skins/:uuid")
  @ApiOperation({ summary: "Получить список скинов пользователя" })
  @ApiParam({ name: "uuid", description: "UUID пользователя" })
  @ApiResponse({ status: 200, type: [UserContentItemDto] })
  async listSkins(@Param("uuid") uuid: string): Promise<UserContentItemDto[]> {
    return this.userContentService.listSkins(uuid);
  }

  @Delete("skins/:id")
  @ApiOperation({ summary: "Удалить скин по ID" })
  @ApiParam({ name: "id", description: "ID скина" })
  @ApiResponse({ status: 200, description: "Скин удалён" })
  @ApiResponse({ status: 403, description: "Нет прав на удаление" })
  @ApiResponse({ status: 400, description: "Скин не найден" })
  async deleteSkin(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ success: boolean }> {
    const userUuid = (request as FastifyRequest & { user: { uuid: string } }).user.uuid;
    await this.userContentService.delete(userUuid, Number(id), "skin");
    return { success: true };
  }

  @Post("models")
  @ApiOperation({ summary: "Загрузить модель (.txt)" })
  @ApiResponse({ status: 201, type: UserContentItemDto })
  @ApiResponse({ status: 400, description: "Лимит загрузки моделей" })
  async uploadModel(@Req() request: FastifyRequest): Promise<UserContentItemDto> {
    const userUuid = (request as FastifyRequest & { user: { uuid: string } }).user.uuid;
    const buffer = await this.extractFile(request);
    return this.userContentService.uploadModel(userUuid, buffer);
  }

  @Get("models/:uuid")
  @ApiOperation({ summary: "Получить список моделей пользователя" })
  @ApiParam({ name: "uuid", description: "UUID пользователя" })
  @ApiResponse({ status: 200, type: [UserContentItemDto] })
  async listModels(@Param("uuid") uuid: string): Promise<UserContentItemDto[]> {
    return this.userContentService.listModels(uuid);
  }

  @Delete("models/:id")
  @ApiOperation({ summary: "Удалить модель по ID" })
  @ApiParam({ name: "id", description: "ID модели" })
  @ApiResponse({ status: 200, description: "Модель удалена" })
  @ApiResponse({ status: 403, description: "Нет прав на удаление" })
  @ApiResponse({ status: 400, description: "Модель не найдена" })
  async deleteModel(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ success: boolean }> {
    const userUuid = (request as FastifyRequest & { user: { uuid: string } }).user.uuid;
    await this.userContentService.delete(userUuid, Number(id), "model");
    return { success: true };
  }

  private async extractFile(request: FastifyRequest): Promise<Buffer> {
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        return await part.toBuffer();
      }
    }
    throw new BadRequestException("Файл не загружен");
  }
}
