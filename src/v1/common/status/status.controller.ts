import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/public.decorator";
import { MinecraftStatusService } from "../../../minecraft-status/minecraft-status.service";
import { MinecraftStatusDto } from "../../../minecraft-status/dto/dto";

@ApiTags("common_status")
@Public()
@Controller("v1/common/status")
export class V1StatusController {
  constructor(private readonly statusService: MinecraftStatusService) {}

  @Get()
  @ApiOperation({
    summary: "Число игроков на игровом сервере (Server List Ping)",
    description:
      "Пингует игровой сервер по MINECRAFT_HOST (формат host, host:port или [ipv6]:port, порт по умолчанию 25565; " +
      "протокол Server List Ping) и возвращает players.online/max. " +
      "Ответ кешируется на 60 секунд — повторные запросы не создают лишних пингов. " +
      "503 — если переменная не задана (фича отключена), формат неверный или игровой сервер недоступен.",
  })
  @ApiOkResponse({ type: MinecraftStatusDto })
  @ApiResponse({
    status: 503,
    description: "Не настроено (нет MINECRAFT_HOST), неверный формат или игровой сервер недоступен",
  })
  async getStatus(): Promise<MinecraftStatusDto> {
    return this.statusService.getOnline();
  }
}
