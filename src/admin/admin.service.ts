import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminMapStoreToken,
  type IAdminStore,
  type AdminUser,
  type UsersFilter,
  type UsersPage,
  type DeletedUsersPage,
} from "./admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";
import { ROLE_WEIGHTS, isKnownRole } from "../common/roles";
import type { RequestUser } from "../common/current-user.decorator";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {}

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    return this.adminStore.searchUsers(filter);
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    return this.adminStore.searchDeletedUsers(filter);
  }

  async setApproved(username: string, approved: boolean, actor: RequestUser): Promise<void> {
    await this.findMutableUser(username, actor, "approve");
    await this.adminStore.setApproved(username, approved);
    this.logger.log(this.audit(actor, username, "approve"), "Статус одобрения изменён");
  }

  async setBanned(username: string, banned: boolean, actor: RequestUser): Promise<void> {
    await this.findMutableUser(username, actor, "ban");
    await this.adminStore.setBanned(username, banned);
    this.logger.log(this.audit(actor, username, "ban"), "Статус бана изменён");
  }

  async setRole(username: string, role: string, actor: RequestUser): Promise<void> {
    if (!this.canAffectRole(actor.role, role)) {
      this.logger.error(
        this.audit(actor, username, "setRole"),
        "Отказ: выдаваемая роль не ниже роли вызывающего",
      );
      throw new ForbiddenException("Невозможно выдать роль, равную или выше собственной");
    }

    const user = await this.findMutableUser(username, actor, "setRole");
    await this.adminStore.setRole(username, role);
    await this.authStore.updateRole(user.uuid, role);
    this.logger.log(this.audit(actor, username, "setRole"), "Роль пользователя изменена");
  }

  async setOwnerRole(username: string, actor: RequestUser): Promise<void> {
    if (actor.role !== "owner") {
      this.logger.error(
        this.audit(actor, username, "setOwner"),
        "Отказ: назначать владельца может только владелец",
      );
      throw new ForbiddenException("Назначать владельца может только владелец");
    }

    const user = await this.adminStore.findByUsername(username);
    if (!user) {
      this.logger.error(this.audit(actor, username, "setOwner"), "Отказ: пользователь не найден");
      throw new NotFoundException(`Пользователь ${username} не найден`);
    }

    await this.adminStore.setRole(username, "owner");
    await this.authStore.updateRole(user.uuid, "owner");
    this.logger.log(this.audit(actor, username, "setOwner"), "Пользователь назначен владельцем");
  }

  async setUserPassword(username: string, password: string, actor: RequestUser): Promise<void> {
    const user = await this.findMutableUser(username, actor, "setPassword");
    const passwordHash = await Bun.password.hash(password);
    await this.authStore.updatePasswordHash(user.uuid, passwordHash, new Date());
    await this.authStore.deleteRefreshByUserId(user.uuid);
    this.logger.log(this.audit(actor, username, "setPassword"), "Пароль пользователя изменён");
  }

  async deleteUser(username: string, actor: RequestUser): Promise<AdminUser> {
    await this.findMutableUser(username, actor, "delete");
    const deleted = await this.adminStore.deleteUser(username);
    if (!deleted) {
      this.logger.error(this.audit(actor, username, "delete"), "Отказ: пользователь не найден");
      throw new NotFoundException(`Пользователь ${username} не найден`);
    }
    this.logger.log(this.audit(actor, username, "delete"), "Пользователь удалён");
    return deleted;
  }

  async restoreUser(username: string, actor: RequestUser): Promise<void> {
    const deleted = await this.adminStore.findDeletedByUsername(username);
    if (!deleted) {
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: удалённый пользователь не найден",
      );
      throw new NotFoundException(`Удалённый пользователь ${username} не найден`);
    }

    if (!this.canAffectRole(actor.role, deleted.role)) {
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: роль восстанавливаемого не ниже роли вызывающего",
      );
      throw new ForbiddenException(
        "Невозможно восстановить пользователя с равной или более высокой ролью",
      );
    }

    const live = await this.adminStore.findByUsername(username);
    if (live) {
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: юзернейм занят живым пользователем",
      );
      throw new ConflictException(`Юзернейм ${username} уже занят живым пользователем`);
    }

    await this.adminStore.restoreUser(username);
    this.logger.log(this.audit(actor, username, "restore"), "Пользователь восстановлен");
  }

  private audit(actor: RequestUser, target: string, action: string): Record<string, string> {
    return { actor: actor.username, actorRole: actor.role, target, action };
  }

  private canAffectRole(callerRole: string, targetRole: string): boolean {
    if (!isKnownRole(callerRole) || !isKnownRole(targetRole)) return false;
    return ROLE_WEIGHTS[callerRole] > ROLE_WEIGHTS[targetRole];
  }

  private async findMutableUser(
    username: string,
    actor: RequestUser,
    action: string,
  ): Promise<AdminUser> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) {
      this.logger.error(this.audit(actor, username, action), "Отказ: пользователь не найден");
      throw new NotFoundException(`Пользователь ${username} не найден`);
    }

    if (!this.canAffectRole(actor.role, user.role)) {
      this.logger.error(
        this.audit(actor, username, action),
        "Отказ: роль цели не ниже роли вызывающего",
      );
      throw new ForbiddenException(
        "Невозможно изменить пользователя с равной или более высокой ролью",
      );
    }

    return user;
  }
}
