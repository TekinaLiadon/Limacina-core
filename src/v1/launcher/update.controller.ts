import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/public.decorator";
import { LauncherService } from "../../launcher/launcher.service";
import { LauncherVersionsDto } from "../../launcher/dto/dto";

@ApiTags("launcher_update")
@Public()
@Controller("v1/launcher/update")
export class V1LauncherUpdateController {
  constructor(private readonly launcherService: LauncherService) {}

  @Get("version")
  @ApiOperation({ summary: "Получить последнюю версию и список всех версий лаунчера" })
  @ApiOkResponse({ type: LauncherVersionsDto })
  getVersions(): LauncherVersionsDto {
    return this.launcherService.getVersions();
  }

  @Get(":os/:arch/download")
  @ApiOperation({ summary: "Скачать лаунчер" })
  @ApiParam({ name: "os", enum: ["linux", "windows"] })
  @ApiParam({ name: "arch", enum: ["x86_64", "aarch64"] })
  @ApiQuery({
    name: "version",
    required: false,
    example: "1.2.3",
    description: "Конкретная версия (по умолчанию — последняя)",
  })
  async download(
    @Param("os") os: string,
    @Param("arch") arch: string,
    @Res() reply: FastifyReply,
    @Query("version") version?: string,
  ): Promise<void> {
    return this.launcherService.download(os, arch, reply, version);
  }
}
