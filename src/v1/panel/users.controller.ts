import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "../../common/public.decorator";
import { Roles } from "../../common/roles.decorator";
import { CurrentUser, type RequestUser } from "../../common/current-user.decorator";
import { SuccessResponseDto, UserSuccessResponseDto } from "../../common/dto/dto";
import { AdminService } from "../../admin/admin.service";
import { TechnicalService } from "../../technical/technical.service";
import { InitOwnerDto, InitOwnerResponseDto } from "../../technical/dto/dto";
import {
  ApproveUserDto,
  BanUserDto,
  DeletedUsersListResponseDto,
  SetRoleDto,
  UsersListResponseDto,
  UsersQueryDto,
  V1DeletedUsersQueryDto,
} from "../../admin/dto/dto";
import type { UsersFilter } from "../../admin/admin.store";

@ApiTags("panel_users")
@ApiBearerAuth()
@Roles("admin")
@Controller("v1/panel/users")
export class V1PanelUsersController {
  constructor(
    private readonly adminService: AdminService,
    private readonly technicalService: TechnicalService,
  ) {}

  @Post("init-owner")
  @Public()
  @ApiOperation({
    summary: "Создать владельца",
    description:
      "Регистрирует пользователя с правами owner. Доступно только если owner ещё не создан. Публичный бутстрап-эндпоинт.",
  })
  @ApiBody({ type: InitOwnerDto })
  @ApiResponse({
    status: 201,
    description: "Владелец создан",
    type: InitOwnerResponseDto,
  })
  @ApiResponse({ status: 409, description: "Владелец уже создан или юзернейм занят" })
  async initOwner(@Body() dto: InitOwnerDto): Promise<InitOwnerResponseDto> {
    return this.technicalService.initOwner(dto.username, dto.password);
  }

  @Get()
  @ApiOperation({
    summary: "Получить список пользователей",
    description:
      "Возвращает страницу пользователей с пагинацией (сортировка по юзернейму). " +
      "Поддерживается поиск по началу юзернейма (без учёта регистра) и фильтр по статусу одобрения.\n\nПримеры:\n" +
      "- `GET /v1/panel/users` — первая страница\n" +
      "- `GET /v1/panel/users?limit=20&offset=20` — вторая страница\n" +
      '- `GET /v1/panel/users?username=joh` — юзернеймы, начинающиеся с "joh"\n' +
      "- `GET /v1/panel/users?approved=false` — только неодобренные\n" +
      '- `GET /v1/panel/users?username=o&approved=true&limit=5` — одобренные, чей юзернейм начинается с "o"',
  })
  @ApiQuery({
    name: "limit",
    required: false,
    example: 10,
    description: "Пользователей на страницу (1–100)",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    example: 0,
    description: "Смещение от начала списка",
  })
  @ApiQuery({
    name: "username",
    required: false,
    example: "john",
    description: "Поиск по началу юзернейма (без учёта регистра)",
  })
  @ApiQuery({
    name: "approved",
    required: false,
    example: false,
    description: "Фильтр по статусу одобрения (false — только неодобренные)",
  })
  @ApiResponse({
    status: 200,
    description: "Страница пользователей с пагинацией",
    type: UsersListResponseDto,
  })
  async getUsers(@Query() query: UsersQueryDto): Promise<UsersListResponseDto> {
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    const filter: UsersFilter = {
      limit,
      offset,
      username: query.username,
      approved: query.approved,
    };
    const { items, total } = await this.adminService.searchUsers(filter);
    return { items, total, limit, offset };
  }

  @Get("deleted")
  @Roles("owner")
  @ApiOperation({
    summary: "Получить список удалённых пользователей",
    description:
      "Возвращает страницу удалённых пользователей с пагинацией (сортировка по юзернейму) " +
      "и поиском по началу юзернейма (без учёта регистра). Доступно только владельцу.\n\nПримеры:\n" +
      "- `GET /v1/panel/users/deleted` — первая страница\n" +
      "- `GET /v1/panel/users/deleted?limit=20&offset=20` — вторая страница\n" +
      '- `GET /v1/panel/users/deleted?username=joh` — юзернеймы, начинающиеся с "joh"',
  })
  @ApiQuery({
    name: "limit",
    required: false,
    example: 10,
    description: "Пользователей на страницу (1–100)",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    example: 0,
    description: "Смещение от начала списка",
  })
  @ApiQuery({
    name: "username",
    required: false,
    example: "john",
    description: "Поиск по началу юзернейма (без учёта регистра)",
  })
  @ApiResponse({
    status: 200,
    description: "Страница удалённых пользователей с пагинацией",
    type: DeletedUsersListResponseDto,
  })
  @ApiResponse({ status: 403, description: "Доступно только владельцу" })
  async getDeletedUsers(
    @Query() query: V1DeletedUsersQueryDto,
  ): Promise<DeletedUsersListResponseDto> {
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    const filter: UsersFilter = {
      limit,
      offset,
      username: query.username,
    };
    const { items, total } = await this.adminService.searchDeletedUsers(filter);
    return { items, total, limit, offset };
  }

  @Patch("approve")
  @ApiOperation({ summary: "Изменить статус одобрения пользователя" })
  @ApiBody({ type: ApproveUserDto })
  @ApiResponse({ status: 200, description: "Статус одобрения изменён", type: SuccessResponseDto })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setApproved(
    @CurrentUser() user: RequestUser,
    @Body() dto: ApproveUserDto,
  ): Promise<SuccessResponseDto> {
    await this.adminService.setApproved(dto.username, dto.approved, user.role);
    return { success: true };
  }

  @Patch("ban")
  @ApiOperation({ summary: "Добавить/убрать пользователя из черного списка" })
  @ApiBody({ type: BanUserDto })
  @ApiResponse({ status: 200, description: "Статус бана изменён", type: SuccessResponseDto })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setBanned(
    @CurrentUser() user: RequestUser,
    @Body() dto: BanUserDto,
  ): Promise<SuccessResponseDto> {
    await this.adminService.setBanned(dto.username, dto.banned, user.role);
    return { success: true };
  }

  @Patch("role")
  @ApiOperation({ summary: "Изменить роль пользователя" })
  @ApiBody({ type: SetRoleDto })
  @ApiResponse({ status: 200, description: "Роль изменена", type: SuccessResponseDto })
  @ApiResponse({ status: 400, description: "Недопустимая роль" })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setRole(
    @CurrentUser() user: RequestUser,
    @Body() dto: SetRoleDto,
  ): Promise<SuccessResponseDto> {
    await this.adminService.setRole(dto.username, dto.role, user.role);
    return { success: true };
  }

  @Delete(":username")
  @ApiOperation({
    summary: "Удалить пользователя",
    description:
      "Переносит пользователя в таблицу удалённых. Через 30 дней удаляется автоматически.",
  })
  @ApiParam({ name: "username", example: "john" })
  @ApiResponse({ status: 200, description: "Пользователь удалён", type: UserSuccessResponseDto })
  @ApiResponse({ status: 403, description: "Невозможно удалить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async deleteUser(
    @CurrentUser() user: RequestUser,
    @Param("username") username: string,
  ): Promise<UserSuccessResponseDto> {
    const deleted = await this.adminService.deleteUser(username, user.role);
    return { success: true, username: deleted.username };
  }

  @Patch(":username/restore")
  @ApiOperation({
    summary: "Восстановить удалённого пользователя",
    description: "Переносит пользователя из таблицы удалённых обратно в таблицу пользователей",
  })
  @ApiParam({ name: "username", example: "john" })
  @ApiResponse({
    status: 200,
    description: "Пользователь восстановлен",
    type: UserSuccessResponseDto,
  })
  @ApiResponse({ status: 404, description: "Удалённый пользователь не найден" })
  async restoreUser(@Param("username") username: string): Promise<UserSuccessResponseDto> {
    await this.adminService.restoreUser(username);
    return { success: true, username };
  }
}
