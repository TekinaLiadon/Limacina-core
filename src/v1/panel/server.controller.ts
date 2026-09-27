import { Body, Controller, Get, HttpStatus, Post, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Roles } from "../../common/roles.decorator";
import { CurrentUser, type RequestUser } from "../../common/current-user.decorator";
import { SuccessResponseDto } from "../../common/dto/dto";
import { TechnicalRestartService } from "../../technical/technical-restart.service";
import { TechnicalRebuildService } from "../../technical/technical-rebuild.service";
import { RebuildStatusDto, RestartServerDto } from "../../technical/dto/dto";

@ApiTags("panel_server")
@ApiBearerAuth()
@Roles("owner")
@Controller("panel/server")
export class V1PanelServerController {
  constructor(
    private readonly restartService: TechnicalRestartService,
    private readonly rebuildService: TechnicalRebuildService,
  ) {}

  @Post("restart")
  @ApiOperation({
    summary: "Перезапустить сервер (опционально с пересборкой) — только owner",
    description:
      "Аккуратно останавливает процесс: ответ клиенту уходит до остановки, затем процессу отправляется SIGTERM " +
      "и Nest закрывает соединения graceful (shutdown hooks). Подъём процесса обратно обеспечивает менеджер процессов " +
      "(pm2, autorestart). Вне pm2 (dev, тесты) процесс просто завершится.\n\n" +
      "С `rebuild: true` запускается фоновый конвейер `git pull --ff-only` → `bun install` → `bun run build` → " +
      "`bun run migrate:up` (каждый шаг со своим таймаутом), ответ 202 возвращается сразу — статус конвейера отдаёт " +
      "GET /v1/panel/server/rebuild. Сборка выполняется до миграций: упавшая сборка оставляет БД нетронутой, а упавшие " +
      "миграции откатывают бинарник из резервной копии dist/Limacina.previous — прод остаётся на согласованной паре " +
      "«бинарник ↔ схема». При ошибке любого шага конвейер прерывается и сервер продолжает работать. " +
      "Параллельный rebuild, как и рестарт во время пересборки, — 409.",
  })
  @ApiBody({ type: RestartServerDto, required: false })
  @ApiResponse({
    status: 201,
    description: "Команда на перезапуск принята",
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 202,
    description: "Конвейер пересборки запущен в фоне; статус — GET /v1/panel/server/rebuild",
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 403, description: "Недостаточно прав (только owner)" })
  @ApiResponse({ status: 409, description: "Пересборка уже выполняется" })
  async restartServer(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto?: RestartServerDto,
  ): Promise<SuccessResponseDto> {
    if (dto?.rebuild) {
      this.rebuildService.startRebuild(user);
      reply.status(HttpStatus.ACCEPTED);
      return { success: true };
    }
    await this.restartService.restartServer(user);
    return { success: true };
  }

  @Get("rebuild")
  @ApiOperation({ summary: "Статус конвейера пересборки — только owner" })
  @ApiResponse({
    status: 200,
    description: "Текущий статус и результат последнего запуска пересборки",
    type: RebuildStatusDto,
  })
  @ApiResponse({ status: 403, description: "Недостаточно прав (только owner)" })
  getRebuildStatus(): RebuildStatusDto {
    return this.rebuildService.getRebuildStatus();
  }
}
