import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { SuccessResponseDto } from "../../common/dto/dto";
import { TechnicalService } from "../../technical/technical.service";
import { RestartServerDto } from "../../technical/dto/dto";

@ApiTags("panel_server")
@ApiBearerAuth()
@Roles("admin")
@Controller("v1/panel/server")
export class V1PanelServerController {
  constructor(private readonly technicalService: TechnicalService) {}

  @Post("restart")
  @ApiOperation({
    summary: "Перезапустить сервер (опционально с пересборкой)",
    description:
      "Аккуратно останавливает процесс: ответ клиенту уходит до остановки, затем процессу отправляется SIGTERM " +
      "и Nest закрывает соединения graceful (shutdown hooks). Подъём процесса обратно обеспечивает менеджер процессов " +
      "(pm2, autorestart). Вне pm2 (dev, тесты) процесс просто завершится.\n\n" +
      "С `rebuild: true` сначала выполняется `bun run build` (новый бинарник `dist/Limacina`, работающий процесс " +
      "не мешает сборке — файл заменяется, старый инод продолжает обслуживать запросы). При ошибке сборки " +
      "перезапуск не выполняется, сервер продолжает работать на старом бинарнике.",
  })
  @ApiBody({ type: RestartServerDto, required: false })
  @ApiResponse({
    status: 201,
    description: "Команда на перезапуск принята (при rebuild — бинарник уже пересобран)",
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 403, description: "Недостаточно прав" })
  @ApiResponse({ status: 500, description: "Пересборка не удалась, перезапуск отменён" })
  async restartServer(@Body() dto?: RestartServerDto): Promise<SuccessResponseDto> {
    await this.technicalService.restartServer(dto?.rebuild ?? false);
    return { success: true };
  }
}
