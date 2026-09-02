import { Body, Controller, Patch, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { LauncherUpdateService } from "../../admin/launcher-update.service";
import { parseLauncherUpdateRequest } from "../../admin/launcher-update.parser";
import { ConfigUpdateService } from "../../admin/config-update.service";
import { PLATFORM_FIELD_NAMES } from "../../launcher/launcher-files";
import { LauncherConfigUpdateDto, LauncherUpdateResponseDto } from "../../admin/dto/dto";
import type { FastifyRequest } from "fastify";

@ApiTags("panel_launcher")
@ApiBearerAuth()
@Roles("admin")
@Controller("v1/panel/launcher")
export class V1PanelLauncherController {
  constructor(
    private readonly launcherUpdateService: LauncherUpdateService,
    private readonly configUpdateService: ConfigUpdateService,
  ) {}

  @Patch()
  @ApiOperation({
    summary: "Обновить версию лаунчера и zip-файлы платформ",
    description:
      `Multipart/form-data: version (x.x.x), файлы ${PLATFORM_FIELD_NAMES.join(", ")} (опционально). ` +
      "Если version не передана — используется текущая. Неизвестные файловые поля отклоняются с 400.",
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
  @ApiBody({ type: LauncherConfigUpdateDto })
  @ApiResponse({ status: 200, description: "Конфиг обновлён", type: LauncherConfigUpdateDto })
  async updateConfig(@Body() dto: LauncherConfigUpdateDto): Promise<LauncherConfigUpdateDto> {
    return this.configUpdateService.update(dto);
  }
}
