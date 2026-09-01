import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
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
import { SuccessResponseDto, UserSuccessResponseDto } from "../../common/dto/dto";
import { AdminService } from "../../admin/admin.service";
import { TechnicalService } from "../../technical/technical.service";
import { InitOwnerDto, InitOwnerResponseDto } from "../../technical/dto/dto";
import {
  ApproveUserDto,
  AllUsersQueryDto,
  BanUserDto,
  DeletedUserListItemDto,
  DeletedUsersQueryDto,
  SetRoleDto,
  UnapprovedUsersQueryDto,
  UserListItemDto,
} from "../../admin/dto/dto";
import type { FastifyRequest } from "fastify";

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
  @ApiOperation({ summary: "Получить список всех пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 100 })
  @ApiResponse({
    status: 200,
    description: "Список пользователей (юзернейм, роль, одобрение, бан)",
    type: [UserListItemDto],
  })
  async getAllUsers(@Query() query: AllUsersQueryDto): Promise<UserListItemDto[]> {
    return this.adminService.findAllUsers(query.limit);
  }

  @Get("unapproved")
  @ApiOperation({ summary: "Получить список неодобренных пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 50 })
  @ApiResponse({
    status: 200,
    description: "Список неодобренных пользователей",
    type: [UserListItemDto],
  })
  async getUnapprovedUsers(@Query() query: UnapprovedUsersQueryDto): Promise<UserListItemDto[]> {
    return this.adminService.findUnapprovedUsers(query.limit);
  }

  @Get("deleted")
  @ApiOperation({ summary: "Получить список удалённых пользователей" })
  @ApiQuery({ name: "limit", required: false, default: 10, maximum: 100 })
  @ApiResponse({
    status: 200,
    description: "Список удалённых пользователей",
    type: [DeletedUserListItemDto],
  })
  async getDeletedUsers(@Query() query: DeletedUsersQueryDto): Promise<DeletedUserListItemDto[]> {
    return this.adminService.findDeletedUsers(query.limit);
  }

  @Patch("approve")
  @ApiOperation({ summary: "Изменить статус одобрения пользователя" })
  @ApiBody({ type: ApproveUserDto })
  @ApiResponse({ status: 200, description: "Статус одобрения изменён", type: SuccessResponseDto })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setApproved(
    @Req() request: FastifyRequest,
    @Body() dto: ApproveUserDto,
  ): Promise<SuccessResponseDto> {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    await this.adminService.setApproved(dto.username, dto.approved, callerRole);
    return { success: true };
  }

  @Patch("ban")
  @ApiOperation({ summary: "Добавить/убрать пользователя из черного списка" })
  @ApiBody({ type: BanUserDto })
  @ApiResponse({ status: 200, description: "Статус бана изменён", type: SuccessResponseDto })
  @ApiResponse({ status: 403, description: "Невозможно изменить owner" })
  @ApiResponse({ status: 404, description: "Пользователь не найден" })
  async setBanned(
    @Req() request: FastifyRequest,
    @Body() dto: BanUserDto,
  ): Promise<SuccessResponseDto> {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    await this.adminService.setBanned(dto.username, dto.banned, callerRole);
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
    @Req() request: FastifyRequest,
    @Body() dto: SetRoleDto,
  ): Promise<SuccessResponseDto> {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    await this.adminService.setRole(dto.username, dto.role, callerRole);
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
    @Req() request: FastifyRequest,
    @Param("username") username: string,
  ): Promise<UserSuccessResponseDto> {
    const callerRole = (request as FastifyRequest & { user: { role: string } }).user.role;
    const deleted = await this.adminService.deleteUser(username, callerRole);
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
