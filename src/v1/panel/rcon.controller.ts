import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { RconService } from "../../rcon/rcon.service";
import { RconCommandsDto, RconExecuteDto, RconOutputDto, RconStatusDto } from "../../rcon/dto/dto";

@ApiTags("panel_server")
@ApiBearerAuth()
@Roles("owner")
@Controller("panel/server/rcon")
export class V1PanelRconController {
  constructor(private readonly rconService: RconService) {}

  @Get()
  @ApiOperation({
    summary: "Статус RCON игрового сервера — только owner",
    description:
      "Проверяет доступность RCON реальным коннектом и авторизацией. Результат кешируется на 10 секунд " +
      "— повторные запросы не открывают лишних соединений. Если RCON не настроен (RCON_HOST/RCON_PASSWORD), " +
      "недоступен или отклоняет авторизацию — { enabled: false }.",
  })
  @ApiOkResponse({
    type: RconStatusDto,
    description: "Статус RCON (кешируется на 10 секунд)",
  })
  @ApiResponse({ status: 401, description: "Требуется авторизация" })
  @ApiResponse({ status: 403, description: "Недостаточно прав (только owner)" })
  async getStatus(): Promise<RconStatusDto> {
    return this.rconService.getStatus();
  }

  @Get("commands")
  @ApiOperation({
    summary: "Дефолтный список команд RCON для автокомплита — только owner",
    description:
      "Отдаёт статический список ванильных команд (Arclight также поддерживает команды плагинов и модов — " +
      "список не исчерпывающий). Работает независимо от доступности RCON.",
  })
  @ApiOkResponse({ type: RconCommandsDto })
  @ApiResponse({ status: 401, description: "Требуется авторизация" })
  @ApiResponse({ status: 403, description: "Недостаточно прав (только owner)" })
  getCommands(): RconCommandsDto {
    return this.rconService.getCommands();
  }

  @Post("execute")
  @HttpCode(200)
  @ApiOperation({
    summary: "Выполнить команду на игровом сервере — только owner",
    description:
      "Выполняет команду через RCON и возвращает текстовый ответ сервера. Команда передаётся без ведущего " +
      "слеша (бек обрезает), триммится, лимит 256 символов; пустая команда или только слеш — 400. " +
      "Текст ошибок Minecraft (неизвестная команда) возвращается в output, а не 5xx. " +
      "Сбой RCON (коннект, таймаут коннекта/чтения, неверный пароль) — 503 с понятным message.",
  })
  @ApiOkResponse({ type: RconOutputDto })
  @ApiResponse({ status: 400, description: "Пустая команда или только слеш" })
  @ApiResponse({ status: 401, description: "Требуется авторизация" })
  @ApiResponse({ status: 403, description: "Недостаточно прав (только owner)" })
  @ApiResponse({
    status: 503,
    description: "RCON не настроен, недоступен или неверный пароль",
  })
  async execute(@Body() dto: RconExecuteDto): Promise<RconOutputDto> {
    return this.rconService.execute(dto.command);
  }
}
