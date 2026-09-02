import { Inject, Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import {
  AdminMapStoreToken,
  type IAdminStore,
  type AdminUser,
  type DeletedUser,
  type UsersFilter,
  type UsersPage,
  type DeletedUsersPage,
} from "./admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";

const ROLE_HIERARCHY = ["user", "moderator", "admin", "owner"] as const;

@Injectable()
export class AdminService {
  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {}

  async findUnapprovedUsers(limit: number = 10): Promise<AdminUser[]> {
    return this.adminStore.findUnapprovedUsers(limit);
  }

  async findAllUsers(limit: number = 10): Promise<AdminUser[]> {
    return this.adminStore.findAllUsers(limit);
  }

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    return this.adminStore.searchUsers(filter);
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    return this.adminStore.searchDeletedUsers(filter);
  }

  async setApproved(username: string, approved: boolean, callerRole: string): Promise<void> {
    await this.findMutableUser(username, callerRole);
    await this.adminStore.setApproved(username, approved);
  }

  async setBanned(username: string, banned: boolean, callerRole: string): Promise<void> {
    await this.findMutableUser(username, callerRole);
    await this.adminStore.setBanned(username, banned);
  }

  async setRole(username: string, role: string, callerRole: string): Promise<void> {
    const user = await this.findMutableUser(username, callerRole);
    await this.adminStore.setRole(username, role);
    await this.authStore.updateRole(user.uuid, role);
  }

  async setOwnerRole(username: string, callerRole: string): Promise<void> {
    if (callerRole !== "owner") {
      throw new ForbiddenException("Назначать владельца может только владелец");
    }

    const user = await this.adminStore.findByUsername(username);
    if (!user) throw new NotFoundException(`Пользователь ${username} не найден`);

    await this.adminStore.setRole(username, "owner");
    await this.authStore.updateRole(user.uuid, "owner");
  }

  async setUserPassword(username: string, password: string, callerRole: string): Promise<void> {
    const user = await this.findMutableUser(username, callerRole);
    const passwordHash = await Bun.password.hash(password);
    await this.authStore.updatePasswordHash(user.uuid, passwordHash);
    await this.authStore.deleteRefreshByUserId(user.uuid);
  }

  async deleteUser(username: string, callerRole: string): Promise<AdminUser> {
    await this.findMutableUser(username, callerRole);
    const deleted = await this.adminStore.deleteUser(username);
    if (!deleted) throw new NotFoundException(`Пользователь ${username} не найден`);
    return deleted;
  }

  async findDeletedUsers(limit: number = 10): Promise<DeletedUser[]> {
    return this.adminStore.findDeletedUsers(limit);
  }

  async restoreUser(username: string, callerRole: string): Promise<void> {
    const deleted = await this.adminStore.findDeletedByUsername(username);
    if (!deleted) throw new NotFoundException(`Удалённый пользователь ${username} не найден`);

    if (!this.canAffectRole(callerRole, deleted.role)) {
      throw new ForbiddenException(
        "Невозможно восстановить пользователя с равной или более высокой ролью",
      );
    }

    await this.adminStore.restoreUser(username);
  }

  private canAffectRole(callerRole: string, targetRole: string): boolean {
    const callerLevel = ROLE_HIERARCHY.indexOf(callerRole as (typeof ROLE_HIERARCHY)[number]);
    const targetLevel = ROLE_HIERARCHY.indexOf(targetRole as (typeof ROLE_HIERARCHY)[number]);
    return callerLevel >= 0 && targetLevel >= 0 && callerLevel > targetLevel;
  }

  private async findMutableUser(username: string, callerRole: string): Promise<AdminUser> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) throw new NotFoundException(`Пользователь ${username} не найден`);

    if (!this.canAffectRole(callerRole, user.role)) {
      throw new ForbiddenException(
        "Невозможно изменить пользователя с равной или более высокой ролью",
      );
    }

    return user;
  }
}
