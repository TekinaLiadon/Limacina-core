import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { SuccessResponseDto } from "../../common/dto/dto";
import { ReleasePublishService } from "../../launcher/release-publish.service";
import { parseLauncherReleaseRequest } from "../../launcher/release-publish.parser";
import { ConfigUpdateService } from "../../launcher/config-update.service";
import { UPDATER_PLATFORM_KEYS } from "../../launcher/launcher-files";
import { LauncherConfigDto, LauncherReleaseResponseDto } from "../../launcher/dto/dto";
import { ModsListResponseDto, ModsUploadResponseDto } from "../../files/dto/dto";
import { parseModsUploadRequest } from "../../files/mods-upload.parser";
import { ModsService } from "../../files/mods.service";
import type { FastifyRequest } from "fastify";

@ApiTags("panel_launcher")
@ApiBearerAuth()
@Roles("owner")
@Controller("panel/launcher")
export class V1PanelLauncherController {
  constructor(
    private readonly launcherReleaseService: ReleasePublishService,
    private readonly configUpdateService: ConfigUpdateService,
    private readonly modsService: ModsService,
  ) {}

  @Patch("release")
  @ApiOperation({
    summary: "Опубликовать релиз лаунчера для tauri-plugin-updater",
    description:
      `Multipart/form-data: version (x.x.x, обязательна) + пары файлов по платформам: ` +
      `<платформа> — артефакт, <платформа>_sig — minisign-подпись (.sig). ` +
      `Платформы: ${UPDATER_PLATFORM_KEYS.join(", ")}. Публикация инкрементальная — ` +
      "CI-джобы по ОС догружают свои платформы в один релиз; повторная публикация заменяет файлы версии. " +
      "Артефакты отдаются клиенту статикой из public/releases через GET /v1/launcher/update/latest.",
  })
  @ApiResponse({
    status: 200,
    description: "Релиз опубликован",
    type: LauncherReleaseResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      "Отсутствует или невалидна version, нет файлов платформ, неизвестная платформа, " +
      "неверное расширение артефакта, повторное поле или неполная пара артефакт+подпись",
  })
  @ApiResponse({
    status: 409,
    description: "Публикация этой версии уже выполняется (лок не освободился за таймаут)",
  })
  async publishRelease(@Req() request: FastifyRequest): Promise<LauncherReleaseResponseDto> {
    const { version, artifacts } = await parseLauncherReleaseRequest(request);
    return await this.launcherReleaseService.publish(version, artifacts);
  }

  @Patch("config")
  @ApiOperation({
    summary: "Создать/обновить конфиг лаунчера",
    description: "Записывает config.toml в корне проекта. Единственная точка записи конфига.",
  })
  @ApiBody({ type: LauncherConfigDto })
  @ApiResponse({ status: 200, description: "Конфиг обновлён", type: LauncherConfigDto })
  async updateConfig(@Body() dto: LauncherConfigDto): Promise<LauncherConfigDto> {
    return this.configUpdateService.update(dto);
  }

  @Get("mods")
  @ApiOperation({
    summary: "Список модов лаунчера — только owner",
    description:
      "Возвращает файлы из папки модов лаунчера (имя и размер). Список кешируется на 30 секунд; " +
      "загрузка и удаление мода сбрасывают кеш.",
  })
  @ApiResponse({ status: 200, description: "Список модов", type: ModsListResponseDto })
  @ApiResponse({ status: 403, description: "Доступно только владельцу" })
  async getMods(): Promise<ModsListResponseDto> {
    return { mods: await this.modsService.getMods() };
  }

  @Post("mods")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Загрузить моды в лаунчер — только owner",
    description:
      "Multipart/form-data: один или несколько .jar-файлов в любых файловых полях. " +
      "Файл с существующим именем заменяется. Загрузка атомарна: при сбое уже записанные файлы " +
      "откатываются, заменённые восстанавливаются. Лимит размера файла — 50 МБ.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
          description: "Файлы модов (.jar); имя поля произвольное",
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Моды загружены", type: ModsUploadResponseDto })
  @ApiResponse({ status: 400, description: "Нет файлов, не-.jar или недопустимое имя" })
  @ApiResponse({ status: 413, description: "Файл превышает лимит размера" })
  @ApiResponse({ status: 403, description: "Доступно только владельцу" })
  async uploadMods(@Req() request: FastifyRequest): Promise<ModsUploadResponseDto> {
    const uploads = await parseModsUploadRequest(request);
    return this.modsService.uploadMods(uploads);
  }

  @Delete("mods/:name")
  @ApiOperation({
    summary: "Удалить мод из лаунчера — только owner",
    description: "Удаляет один файл из папки модов и сбрасывает кеш списка.",
  })
  @ApiParam({ name: "name", example: "jei-1.21.1-19.21.0.247.jar" })
  @ApiResponse({ status: 200, description: "Мод удалён", type: SuccessResponseDto })
  @ApiResponse({ status: 400, description: "Недопустимое имя файла" })
  @ApiResponse({ status: 404, description: "Мод не найден" })
  @ApiResponse({ status: 403, description: "Доступно только владельцу" })
  async deleteMod(@Param("name") name: string): Promise<SuccessResponseDto> {
    await this.modsService.deleteMod(name);
    return { success: true };
  }
}
