import { Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { SuccessResponseDto } from "../../common/dto/dto";
import { TechnicalService } from "../../technical/technical.service";

@ApiTags("panel_server")
@ApiBearerAuth()
@Roles("admin")
@Controller("v1/panel/server")
export class V1PanelServerController {
  constructor(private readonly technicalService: TechnicalService) {}

  @Post("restart")
  @ApiOperation({
    summary: "Перезапустить сервер",
    description:
      "Аккуратно останавливает процесс: ответ клиенту уходит до остановки, затем процессу отправляется SIGTERM " +
      "и Nest закрывает соединения graceful (shutdown hooks). Подъём процесса обратно обеспечивает менеджер процессов " +
      "(pm2, autorestart). Вне pm2 (dev, тесты) процесс просто завершится.",
  })
  @ApiResponse({
    status: 201,
    description: "Команда на перезапуск принята",
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 403, description: "Недостаточно прав" })
  async restartServer(): Promise<SuccessResponseDto> {
    this.technicalService.restartServer();
    return { success: true };
  }
}
