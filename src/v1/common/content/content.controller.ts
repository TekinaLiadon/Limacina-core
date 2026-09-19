import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  enumPipeExceptionFactory,
  intPipeExceptionFactory,
} from "../../../common/validation-pipes";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UserContentService } from "../../../user-content/user-content.service";
import { SKIN_MODELS, type SkinModel } from "../../../utils/texture";
import {
  MODEL_UPLOAD_LIMIT_BYTES,
  TEXTURE_UPLOAD_LIMIT_BYTES,
  parseContentUpload,
} from "../../../user-content/user-content.parser";
import { SuccessResponseDto } from "../../../common/dto/dto";
import { CurrentUser, type RequestUser } from "../../../common/current-user.decorator";
import {
  SetActiveSkinDto,
  UserContentItemDto,
  UserContentUploadResponseDto,
} from "../../../user-content/dto/dto";
import type { FastifyRequest } from "fastify";

@ApiTags("common_content")
@ApiBearerAuth()
@Controller("common/content")
export class V1ContentController {
  constructor(private readonly userContentService: UserContentService) {}

  @Post("skins")
  @ApiOperation({ summary: "Загрузить скин (.png)" })
  @ApiResponse({ status: 201, type: UserContentUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: "Лимит загрузки скинов, невалидный PNG или превышен размер (512 КБ)",
  })
  @ApiResponse({ status: 413, description: "Превышен стрим-лимит загрузки (1 МБ)" })
  async uploadSkin(
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
    @Query(
      "model",
      new ParseEnumPipe(SKIN_MODELS, {
        optional: true,
        exceptionFactory: enumPipeExceptionFactory("model", [...SKIN_MODELS]),
      }),
    )
    model?: SkinModel,
  ): Promise<UserContentUploadResponseDto> {
    const buffer = await parseContentUpload(request, TEXTURE_UPLOAD_LIMIT_BYTES);
    return this.userContentService.uploadSkin(user.uuid, user.username, buffer, model ?? undefined);
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
  @ApiResponse({ status: 200, description: "Скин удалён", type: SuccessResponseDto })
  @ApiResponse({ status: 400, description: "Нельзя удалить дефолтный скин" })
  @ApiResponse({ status: 403, description: "Нет прав на удаление" })
  @ApiResponse({ status: 404, description: "Скин не найден" })
  async deleteSkin(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseIntPipe({ exceptionFactory: intPipeExceptionFactory("id") }))
    id: number,
  ): Promise<SuccessResponseDto> {
    await this.userContentService.delete(user.uuid, id, "skin");
    return { success: true };
  }

  @Patch("skins/active")
  @ApiOperation({ summary: "Сменить активный скин" })
  @ApiResponse({ status: 200, description: "Активный скин изменён", type: SuccessResponseDto })
  @ApiResponse({ status: 400, description: "Нельзя выбрать дефолтный скин как активный" })
  @ApiResponse({ status: 403, description: "Нет прав на смену активного скина" })
  @ApiResponse({ status: 404, description: "Скин не найден" })
  async setActiveSkin(
    @CurrentUser() user: RequestUser,
    @Body() dto: SetActiveSkinDto,
  ): Promise<SuccessResponseDto> {
    await this.userContentService.setActiveSkin(user.uuid, dto.id);
    return { success: true };
  }

  @Post("capes")
  @ApiOperation({ summary: "Загрузить плащ (.png)" })
  @ApiResponse({ status: 201, type: UserContentUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: "Лимит загрузки плащей, невалидный PNG или превышен размер (512 КБ)",
  })
  @ApiResponse({ status: 413, description: "Превышен стрим-лимит загрузки (1 МБ)" })
  async uploadCape(
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
  ): Promise<UserContentUploadResponseDto> {
    const buffer = await parseContentUpload(request, TEXTURE_UPLOAD_LIMIT_BYTES);
    return this.userContentService.uploadCape(user.uuid, user.username, buffer);
  }

  @Get("capes/:uuid")
  @ApiOperation({ summary: "Получить список плащей пользователя" })
  @ApiParam({ name: "uuid", description: "UUID пользователя" })
  @ApiResponse({ status: 200, type: [UserContentItemDto] })
  async listCapes(@Param("uuid") uuid: string): Promise<UserContentItemDto[]> {
    return this.userContentService.listCapes(uuid);
  }

  @Delete("capes/:id")
  @ApiOperation({ summary: "Удалить плащ по ID" })
  @ApiParam({ name: "id", description: "ID плаща" })
  @ApiResponse({ status: 200, description: "Плащ удалён", type: SuccessResponseDto })
  @ApiResponse({ status: 403, description: "Нет прав на удаление" })
  @ApiResponse({ status: 404, description: "Плащ не найден" })
  async deleteCape(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseIntPipe({ exceptionFactory: intPipeExceptionFactory("id") }))
    id: number,
  ): Promise<SuccessResponseDto> {
    await this.userContentService.delete(user.uuid, id, "cape");
    return { success: true };
  }

  @Post("models")
  @ApiOperation({ summary: "Загрузить модель (.txt)" })
  @ApiResponse({ status: 201, type: UserContentUploadResponseDto })
  @ApiResponse({ status: 400, description: "Лимит загрузки моделей, пустой или невалидный файл" })
  @ApiResponse({ status: 413, description: "Превышен стрим-лимит загрузки (512 КБ)" })
  async uploadModel(
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
  ): Promise<UserContentUploadResponseDto> {
    const buffer = await parseContentUpload(request, MODEL_UPLOAD_LIMIT_BYTES);
    return this.userContentService.uploadModel(user.uuid, user.username, buffer);
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
  @ApiResponse({ status: 200, description: "Модель удалена", type: SuccessResponseDto })
  @ApiResponse({ status: 403, description: "Нет прав на удаление" })
  @ApiResponse({ status: 404, description: "Модель не найдена" })
  async deleteModel(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseIntPipe({ exceptionFactory: intPipeExceptionFactory("id") }))
    id: number,
  ): Promise<SuccessResponseDto> {
    await this.userContentService.delete(user.uuid, id, "model");
    return { success: true };
  }
}
