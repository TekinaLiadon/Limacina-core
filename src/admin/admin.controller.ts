import { Body, Controller, Delete, Get, Param, Patch, Query, Req } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/roles.decorator";
import { AdminService } from "./admin.service";
import { LogsService } from "./logs.service";
import { LauncherUpdateService } from "./launcher-update.service";
import { ConfigUpdateService } from "./config-update.service";
import {
  ApproveUserDto,
  AllUsersQueryDto,
  BanUserDto,
  DeletedUserListItemDto,
  DeletedUsersQueryDto,
  LauncherConfigUpdateDto,
  LogsQueryDto,
  LogsResponseDto,
  SetRoleDto,
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
    private readonly configUpdateService: ConfigUpdateService,
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
    description: "Список пользователей (юзернейм, роль, одобрение, бан)",
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
  @ApiQuery({
    name: "date",
    required: false,
    example: "2026-07-08",
    description: "Дата YYYY-MM-DD (по умолчанию сегодня)",
  })
  @ApiQuery({ name: "offset", required: false, example: 0, description: "Смещение от начала" })
  @ApiQuery({ name: "limit", required: false, example: 100, description: "Максимум строк" })
  @ApiResponse({
    status: 200,
    description: "Страница логов с пагинацией",
    type: LogsResponseDto,
  })
  async getLogs(@Query() query: LogsQueryDto) {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const { lines, total } = this.logsService.getLines(date, query.offset ?? 0, query.limit ?? 100);
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
      'Возвращает массив дат в формате YYYY-MM-DD, за которые есть лог-файлы. Сегодняшняя дата всегда присутствует в списке.\n\nПример ответа: `["2026-07-08", "2026-07-07", "2026-07-06"]`',
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
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setApproved(@Req() request: FastifyRequest, @Body() dto: ApproveUserDto) {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    await this.adminService.setApproved(dto.username, dto.approved, callerRole);
    return { success: true };
  }

  @Patch("ban")
  @ApiOperation({ summary: "Добавить/убрать пользователя из черного списка" })
  @ApiBody({ type: BanUserDto })
  @ApiResponse({ status: 200, description: "Статус бана изменён" })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setBanned(@Req() request: FastifyRequest, @Body() dto: BanUserDto) {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    await this.adminService.setBanned(dto.username, dto.banned, callerRole);
    return { success: true };
  }

  @Patch("role")
  @ApiOperation({ summary: "Изменить роль пользователя" })
  @ApiBody({ type: SetRoleDto })
  @ApiResponse({ status: 200, description: "Роль изменена" })
  @ApiResponse({ status: 400, description: "Недопустимая роль" })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setRole(@Req() request: FastifyRequest, @Body() dto: SetRoleDto) {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    await this.adminService.setRole(dto.username, dto.role, callerRole);
    return { success: true };
  }

  @Delete("users/:username")
  @ApiOperation({
    summary: "Удалить пользователя",
    description:
      "Переносит пользователя в таблицу удалённых. Через 30 дней удаляется автоматически.",
  })
  @ApiParam({ name: "username", example: "john" })
  @ApiResponse({ status: 200, description: "Пользователь удалён" })
  @ApiResponse({ status: 403, description: "Невозможно удалить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async deleteUser(@Req() request: FastifyRequest, @Param("username") username: string) {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    const deleted = await this.adminService.deleteUser(username, callerRole);
    return { success: true, username: deleted.username };
  }

  @Get("users/deleted")
  @ApiOperation({ summary: "Получить список удалённых пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 100 })
  @ApiResponse({
    status: 200,
    description: "Список удалённых пользователей",
    type: [DeletedUserListItemDto],
  })
  async getDeletedUsers(@Query() query: DeletedUsersQueryDto) {
    return this.adminService.findDeletedUsers(query.limit);
  }

  @Patch("users/:username/restore")
  @ApiOperation({
    summary: "Восстановить удалённого пользователя",
    description: "Переносит пользователя из таблицы удалённых обратно в таблицу пользователей",
  })
  @ApiParam({ name: "username", example: "john" })
  @ApiResponse({ status: 200, description: "Пользователь восстановлен" })
  @ApiResponse({ status: 404, description: "Удалённый пользователь не найден" })
  async restoreUser(@Param("username") username: string) {
    await this.adminService.restoreUser(username);
    return { success: true, username };
  }

  @Patch("launcher")
  @ApiOperation({
    summary: "Обновить версию лаунчера и zip-файлы платформ",
    description:
      "Multipart/form-data: version (x.x.x), файлы linux_x86_64, linux_aarch64, windows_x86_64 (опционально)",
  })
  @ApiResponse({ status: 200, description: "Лаунчер обновлён" })
  @ApiResponse({ status: 400, description: "Невалидная версия или платформа" })
  async updateLauncher(@Req() request: FastifyRequest) {
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

  @Patch("config")
  @ApiOperation({
    summary: "Создать/обновить конфиг лаунчера",
    description: "Записывает config.toml в корне проекта",
  })
  @ApiBody({ type: LauncherConfigUpdateDto })
  @ApiResponse({ status: 200, description: "Конфиг обновлён", type: LauncherConfigUpdateDto })
  async updateConfig(@Body() dto: LauncherConfigUpdateDto) {
    return this.configUpdateService.update(dto);
  }
}
