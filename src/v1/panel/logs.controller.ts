import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/roles.decorator";
import { LogsService } from "../../admin/logs.service";
import type { LogsFilter } from "../../admin/logs.service";
import { LogsResponseDto, V1LogsQueryDto } from "../../admin/dto/dto";

@ApiTags("panel_logs")
@ApiBearerAuth()
@Roles("admin")
@Controller("v1/panel/logs")
export class V1PanelLogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @ApiOperation({
    summary: "Получить логи HTTP-запросов за конкретную дату",
    description:
      "Возвращает строки лог-файла за указанную дату с пагинацией — только записи HTTP-запросов (с кодом статуса). " +
      "Поддерживается фильтрация по статус-коду, URL и IP. Если дата не указана — используется сегодняшняя.\n\nПримеры:\n" +
      "- `GET /v1/panel/logs` — логи за сегодня\n" +
      "- `GET /v1/panel/logs?date=2026-07-08&offset=0&limit=50` — первые 50 строк за 8 июля\n" +
      "- `GET /v1/panel/logs?date=2026-07-08&statusCode=500` — только ответы с кодом 500\n" +
      "- `GET /v1/panel/logs?date=2026-07-08&url=/v1/common/auth` — запросы к auth-эндпоинтам\n" +
      "- `GET /v1/panel/logs?date=2026-07-08&ip=127.0.0.1&statusCode=200` — успешные запросы с 127.0.0.1",
  })
  @ApiQuery({
    name: "date",
    required: false,
    example: "2026-07-08",
    description: "Дата YYYY-MM-DD (по умолчанию сегодня)",
  })
  @ApiQuery({ name: "offset", required: false, example: 0, description: "Смещение от начала" })
  @ApiQuery({ name: "limit", required: false, example: 100, description: "Максимум строк" })
  @ApiQuery({
    name: "statusCode",
    required: false,
    example: 200,
    description: "Фильтр по статус-коду ответа (точное совпадение)",
  })
  @ApiQuery({
    name: "url",
    required: false,
    example: "/v1/common/auth",
    description: "Фильтр по URL запроса (подстрока, без учёта регистра)",
  })
  @ApiQuery({
    name: "ip",
    required: false,
    example: "127.0.0.1",
    description: "Фильтр по IP клиента (подстрока, без учёта регистра)",
  })
  @ApiResponse({
    status: 200,
    description: "Страница логов с пагинацией",
    type: LogsResponseDto,
  })
  async getLogs(@Query() query: V1LogsQueryDto): Promise<LogsResponseDto> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const filter: LogsFilter = {
      statusCode: query.statusCode,
      url: query.url,
      ip: query.ip,
    };
    const { lines, total } = this.logsService.getLines(
      date,
      query.offset ?? 0,
      query.limit ?? 100,
      filter,
    );
    return {
      date,
      offset: query.offset ?? 0,
      limit: query.limit ?? 100,
      total,
      lines,
    };
  }

  @Get("dates")
  @ApiOperation({
    summary: "Список доступных дат с логами",
    description:
      'Возвращает массив дат в формате YYYY-MM-DD, за которые есть лог-файлы. Сегодняшняя дата всегда присутствует в списке.\n\nПример ответа: `["2026-07-08", "2026-07-07", "2026-07-06"]`',
  })
  @ApiResponse({
    status: 200,
    description: "Массив дат (YYYY-MM-DD), отсортированных от новых к старым",
    schema: { type: "array", items: { type: "string", example: "2026-07-08" } },
    example: ["2026-07-08", "2026-07-07", "2026-07-06"],
  })
  async getLogDates(): Promise<string[]> {
    return this.logsService.listAvailableDates();
  }
}
