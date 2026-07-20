import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Public } from "../common/public.decorator";
import { LauncherService } from "./launcher.service";
import { LauncherConfigCreateDto, LauncherConfigDto, LauncherVersionDto } from "./dto/dto";

@ApiTags("launcher")
@Public()
@Controller("launcher")
export class LauncherController {
  constructor(private readonly launcherService: LauncherService) {}

  @Get("version")
  @ApiOperation({ summary: "Получить текущую версию лаунчера" })
  @ApiOkResponse({ type: LauncherVersionDto })
  getVersion(): LauncherVersionDto {
    return this.launcherService.getVersion();
  }

  @Get("config")
  @ApiOperation({ summary: "Получить конфиг лаунчера" })
  @ApiOkResponse({ type: LauncherConfigDto })
  getConfig(): LauncherConfigDto {
    return this.launcherService.getConfig();
  }

  @Post("config")
  @ApiOperation({ summary: "Создать конфиг лаунчера если не существует" })
  @ApiOkResponse({ type: LauncherConfigDto })
  createConfig(@Body() dto: LauncherConfigCreateDto): LauncherConfigDto {
    return this.launcherService.createConfig(dto);
  }

  @Get(":os/:arch/download")
  @ApiOperation({ summary: "Скачать лаунчер" })
  @ApiParam({ name: "os", enum: ["linux", "windows"] })
  @ApiParam({ name: "arch", enum: ["x86_64", "aarch64"] })
  async download(
    @Param("os") os: string,
    @Param("arch") arch: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.launcherService.download(os, arch, reply);
  }
}
