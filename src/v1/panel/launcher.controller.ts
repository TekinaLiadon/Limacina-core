import { Body, Controller, Patch, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { LauncherUpdateService } from "../../admin/launcher-update.service";
import { ConfigUpdateService } from "../../admin/config-update.service";
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
      "Multipart/form-data: version (x.x.x), файлы linux_x86_64, linux_aarch64, windows_x86_64 (опционально)",
  })
  @ApiResponse({ status: 200, description: "Лаунчер обновлён", type: LauncherUpdateResponseDto })
  @ApiResponse({ status: 400, description: "Невалидная версия или платформа" })
  async updateLauncher(@Req() request: FastifyRequest): Promise<LauncherUpdateResponseDto> {
    const parts = request.parts();
    let version = "";
    const files: { os: string; arch: string; buffer: Buffer }[] = [];

    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "version") {
        version = part.value as string;
      } else if (part.type === "file") {
        const platform = this.parsePlatform(part.fieldname);
        if (platform) {
          const buffer = await part.toBuffer();
          files.push({ ...platform, buffer });
        }
      }
    }

    if (!version) {
      version = this.launcherUpdateService.getCurrentVersion();
    }

    return this.launcherUpdateService.update(version, files);
  }

  private parsePlatform(fieldname: string): { os: string; arch: string } | null {
    const map: Record<string, { os: string; arch: string }> = {
      linux_x86_64: { os: "linux", arch: "x86_64" },
      linux_aarch64: { os: "linux", arch: "aarch64" },
      windows_x86_64: { os: "windows", arch: "x86_64" },
    };
    return map[fieldname] ?? null;
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
