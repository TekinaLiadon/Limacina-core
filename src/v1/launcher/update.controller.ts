import { enumPipeExceptionFactory } from "../../common/validation-pipes";
import { Controller, Get, Param, ParseEnumPipe, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/public.decorator";
import { LauncherService } from "../../launcher/launcher.service";
import { LauncherReleasesService } from "../../launcher/launcher-releases.service";
import { SUPPORTED_ARCHS, SUPPORTED_OS } from "../../launcher/launcher-files";
import {
  LauncherVersionsDto,
  UpdaterLatestDto,
  UpdaterReleasesListDto,
} from "../../launcher/dto/dto";

@ApiTags("launcher_update")
@Public()
@Controller("launcher/update")
export class V1LauncherUpdateController {
  constructor(
    private readonly launcherService: LauncherService,
    private readonly launcherReleasesService: LauncherReleasesService,
  ) {}

  @Get(["latest", "latest.json"])
  @ApiOperation({
    summary: "latest.json для tauri-plugin-updater (текущий релиз или откат на конкретный)",
    description:
      "Формат продиктован tauri-plugin-updater. Без параметра — старшая опубликованная версия; " +
      "?version=x.y.z — latest.json той версии (запрос клиента при «Откатить лаунчер»). " +
      "Алиас latest.json — для старых сборок лаунчера, строящих URL с суффиксом .json. " +
      "Артефакты раздаются статикой из public/releases по url из ответа.",
  })
  @ApiQuery({
    name: "version",
    required: false,
    example: "1.2.3",
    description: "Конкретная версия релиза (для отката); по умолчанию — старшая доступная",
  })
  @ApiOkResponse({ type: UpdaterLatestDto })
  getLatest(@Query("version") version?: string): UpdaterLatestDto {
    return this.launcherReleasesService.getLatest(version);
  }

  @Get(":version/latest.json")
  @ApiOperation({
    summary: "latest.json конкретной версии (алиас старых сборок лаунчера)",
    description:
      "Алиас GET /latest?version=x.y.z для старых сборок лаунчера: версия передаётся в пути " +
      "после суффикса .json. Формат и поведение — как у канонического маршрута.",
  })
  @ApiParam({ name: "version", example: "1.2.3", description: "Версия релиза (для отката)" })
  @ApiOkResponse({ type: UpdaterLatestDto })
  getLatestByVersion(@Param("version") version: string): UpdaterLatestDto {
    return this.launcherReleasesService.getLatest(version);
  }

  @Get("releases")
  @ApiOperation({
    summary: "Список релизов лаунчера для апдейтера (от новых к старым)",
    description:
      "Релизы с полной парой артефакт+подпись хотя бы по одной платформе. " +
      "Клиент выбирает версию отсюда и запрашивает GET /v1/launcher/update/latest?version=",
  })
  @ApiOkResponse({ type: UpdaterReleasesListDto })
  getReleases(): UpdaterReleasesListDto {
    return this.launcherReleasesService.listReleases();
  }

  @Get("version")
  @ApiOperation({
    summary: "Получить последнюю версию и список всех версий лаунчера (zip-протокол)",
    description:
      "Устарел: старый zip-протокол переноса распаковкой. Новые клиенты используют " +
      "GET /v1/launcher/update/latest (tauri-plugin-updater).",
    deprecated: true,
  })
  @ApiOkResponse({ type: LauncherVersionsDto })
  getVersions(): LauncherVersionsDto {
    return this.launcherService.getVersions();
  }

  @Get(":os/:arch/download")
  @ApiOperation({
    summary: "Скачать zip лаунчера (старый протокол)",
    description:
      "Устарел: старый zip-протокол. Новые клиенты получают артефакты по url из " +
      "GET /v1/launcher/update/latest (tauri-plugin-updater).",
    deprecated: true,
  })
  @ApiParam({ name: "os", enum: SUPPORTED_OS })
  @ApiParam({ name: "arch", enum: SUPPORTED_ARCHS })
  @ApiQuery({
    name: "version",
    required: false,
    example: "1.2.3",
    description: "Конкретная версия (по умолчанию — последняя)",
  })
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async download(
    @Param(
      "os",
      new ParseEnumPipe(SUPPORTED_OS, {
        exceptionFactory: enumPipeExceptionFactory("os", SUPPORTED_OS),
      }),
    )
    os: string,
    @Param(
      "arch",
      new ParseEnumPipe(SUPPORTED_ARCHS, {
        exceptionFactory: enumPipeExceptionFactory("arch", SUPPORTED_ARCHS),
      }),
    )
    arch: string,
    @Res() reply: FastifyReply,
    @Query("version") version?: string,
  ): Promise<void> {
    return this.launcherService.download(os, arch, reply, version);
  }
}
