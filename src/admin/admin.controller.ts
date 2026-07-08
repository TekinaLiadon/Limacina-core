import { Body, Controller, Get, Patch, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/roles.decorator";
import { AdminService } from "./admin.service";
import { LogsService } from "./logs.service";
import { LauncherUpdateService } from "./launcher-update.service";
import {
  ApproveUserDto,
  AllUsersQueryDto,
  BanUserDto,
  LogsQueryDto,
  LogsResponseDto,
  UnapprovedUsersQueryDto,
  UserListItemDto,
} from "./dto/dto";
import type { FastifyRequest } from "fastify";

@ApiTags("admin")
@ApiBearerAuth()
@Roles("admin")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly logsService: LogsService,
    private readonly launcherUpdateService: LauncherUpdateService,
  ) {}

  @Get("unapproved")
  @ApiOperation({ summary: "Получить список неодобренных пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 50 })
  @ApiResponse({ status: 200, description: "Список неодобренных пользователей" })
  async getUnapprovedUsers(@Query() query: UnapprovedUsersQueryDto) {
    return this.adminService.findUnapprovedUsers(query.limit);
  }

  @Get("users")
  @ApiOperation({ summary: "Получить список всех пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 100 })
  @ApiResponse({
    status: 200,
    description: "Список пользователей (юзернейм, роль, бан)",
    type: [UserListItemDto],
  })
  async getAllUsers(@Query() query: AllUsersQueryDto) {
    return this.adminService.findAllUsers(query.limit);
  }

  @Get("logs")
  @ApiOperation({
    summary: "Получить логи за конкретную дату",
    description:
      "Возвращает строки лог-файла за указанную дату с пагинацией. Если дата не указана — используется сегодняшняя.\n\nПримеры:\n- `GET /admin/logs` — логи за сегодня\n- `GET /admin/logs?date=2026-07-08` — логи за 8 июля 2026\n- `GET /admin/logs?date=2026-07-08&offset=0&limit=50` — первые 50 строк за 8 июля",
  })
  @ApiQuery({ name: "date", required: false, example: "2026-07-08", description: "Дата YYYY-MM-DD (по умолчанию сегодня)" })
  @ApiQuery({ name: "offset", required: false, example: 0, description: "Смещение от начала" })
  @ApiQuery({ name: "limit", required: false, example: 100, description: "Максимум строк" })
  @ApiResponse({
    status: 200,
    description: "Страница логов с пагинацией",
    type: LogsResponseDto,
  })
  async getLogs(@Query() query: LogsQueryDto) {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const { lines, total } = this.logsService.getLines(
      date,
      query.offset ?? 0,
      query.limit ?? 100,
    );
    return {
      date,
      offset: query.offset ?? 0,
      limit: query.limit ?? 100,
      total,
      lines,
    };
  }

  @Get("logs/dates")
  @ApiOperation({
    summary: "Список доступных дат с логами",
    description:
      "Возвращает массив дат в формате YYYY-MM-DD, за которые есть лог-файлы. Сегодняшняя дата всегда присутствует в списке.\n\nПример ответа: `[\"2026-07-08\", \"2026-07-07\", \"2026-07-06\"]`",
  })
  @ApiResponse({
    status: 200,
    description: "Массив дат (YYYY-MM-DD), отсортированных от новых к старым",
    schema: { type: "array", items: { type: "string", example: "2026-07-08" } },
    example: ["2026-07-08", "2026-07-07", "2026-07-06"],
  })
  async getLogDates() {
    return this.logsService.listAvailableDates();
  }

  @Patch("approve")
  @ApiOperation({ summary: "Изменить статус одобрения пользователя" })
  @ApiBody({ type: ApproveUserDto })
  @ApiResponse({ status: 200, description: "Статус одобрения изменён" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setApproved(@Body() dto: ApproveUserDto) {
    await this.adminService.setApproved(dto.username, dto.approved);
    return { success: true };
  }

  @Patch("ban")
  @ApiOperation({ summary: "Добавить/убрать пользователя из черного списка" })
  @ApiBody({ type: BanUserDto })
  @ApiResponse({ status: 200, description: "Статус бана изменён" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setBanned(@Body() dto: BanUserDto) {
    await this.adminService.setBanned(dto.username, dto.banned);
    return { success: true };
  }

  @Patch("launcher")
  @ApiOperation({
    summary: "Обновить версию лаунчера и zip-файлы платформ",
    description:
      "Multipart/form-data: version (x.x.x), файлы linux_x86_64, linux_aarch64, windows_x86_64 (опционально)",
  })
  @ApiResponse({ status: 200, description: "Лаунчер обновлён" })
  @ApiResponse({ status: 400, description: "Невалидная версия или платформа" })
  async updateLauncher(@Body() _body: unknown, @Query() _query: unknown, request: FastifyRequest) {
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
}
