import { BadRequestException, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UserContentService } from "./user-content.service";
import { UserContentItemDto } from "./dto/dto";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import type { FastifyRequest } from "fastify";

@ApiTags("user-content", "legacy")
@ApiBearerAuth()
@Controller("user-content")
export class UserContentController {
  constructor(private readonly userContentService: UserContentService) {}

  @Post("skins")
  @ApiOperation({ summary: "Загрузить скин (.png)" })
  @ApiResponse({ status: 201, type: UserContentItemDto })
  @ApiResponse({
    status: 400,
    description: "Лимит загрузки скинов, невалидный PNG или превышен размер (512 КБ)",
  })
  async uploadSkin(
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
  ): Promise<UserContentItemDto> {
    const buffer = await this.extractFile(request);
    return this.userContentService.uploadSkin(user.uuid, buffer);
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
  @ApiResponse({ status: 404, description: "Скин не найден" })
  async deleteSkin(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ success: boolean }> {
    await this.userContentService.delete(user.uuid, Number(id), "skin");
    return { success: true };
  }

  @Post("models")
  @ApiOperation({ summary: "Загрузить модель (.txt)" })
  @ApiResponse({ status: 201, type: UserContentItemDto })
  @ApiResponse({ status: 400, description: "Лимит загрузки моделей" })
  async uploadModel(
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
  ): Promise<UserContentItemDto> {
    const buffer = await this.extractFile(request);
    return this.userContentService.uploadModel(user.uuid, buffer);
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
  @ApiResponse({ status: 404, description: "Модель не найдена" })
  async deleteModel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ success: boolean }> {
    await this.userContentService.delete(user.uuid, Number(id), "model");
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
