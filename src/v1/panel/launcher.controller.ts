import { Body, Controller, Patch, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { LauncherUpdateService } from "../../admin/launcher-update.service";
import { parseLauncherUpdateRequest } from "../../admin/launcher-update.parser";
import { LauncherReleaseService } from "../../admin/launcher-release.service";
import { parseLauncherReleaseRequest } from "../../admin/launcher-release.parser";
import { ConfigUpdateService } from "../../admin/config-update.service";
import { PLATFORM_FIELD_NAMES, UPDATER_PLATFORM_KEYS } from "../../launcher/launcher-files";
import { LauncherConfigDto } from "../../launcher/dto/dto";
import { LauncherReleaseResponseDto, LauncherUpdateResponseDto } from "../../admin/dto/dto";
import type { FastifyRequest } from "fastify";

@ApiTags("panel_launcher")
@ApiBearerAuth()
@Roles("admin")
@Controller("panel/launcher")
export class V1PanelLauncherController {
  constructor(
    private readonly launcherUpdateService: LauncherUpdateService,
    private readonly launcherReleaseService: LauncherReleaseService,
    private readonly configUpdateService: ConfigUpdateService,
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
      "Невалидная версия, неизвестная платформа, неверное расширение артефакта или неполная пара артефакт+подпись",
  })
  @ApiResponse({
    status: 409,
    description: "Публикация этой версии уже выполняется (лок не освободился за таймаут)",
  })
  async publishRelease(@Req() request: FastifyRequest): Promise<LauncherReleaseResponseDto> {
    const { version, artifacts } = await parseLauncherReleaseRequest(request);
    return await this.launcherReleaseService.publish(version, artifacts);
  }

  @Patch()
  @ApiOperation({
    summary: "Обновить версию лаунчера и zip-файлы платформ (старый zip-протокол)",
    description:
      `Устарел: zip-протокол переноса распаковкой. Новые релизы публикуются через ` +
      "PATCH /v1/panel/launcher/release (tauri-plugin-updater). " +
      `Multipart/form-data: version (x.x.x), файлы ${PLATFORM_FIELD_NAMES.join(", ")} (опционально). ` +
      "Если version не передана — используется текущая. Неизвестные файловые поля отклоняются с 400.",
    deprecated: true,
  })
  @ApiResponse({ status: 200, description: "Лаунчер обновлён", type: LauncherUpdateResponseDto })
  @ApiResponse({
    status: 400,
    description: "Невалидная версия, неподдерживаемая платформа или неизвестное файловое поле",
  })
  async updateLauncher(@Req() request: FastifyRequest): Promise<LauncherUpdateResponseDto> {
    const { version, files } = await parseLauncherUpdateRequest(request);
    return this.launcherUpdateService.update(version, files);
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
}
