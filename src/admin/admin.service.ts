import { Inject, Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import {
  AdminMapStoreToken,
  type IAdminStore,
  type AdminUser,
  type DeletedUser,
} from "./admin.store";

export interface UserListItem {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

const ROLE_HIERARCHY = ["user", "moderator", "admin", "owner"] as const;

@Injectable()
export class AdminService {
  constructor(@Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore) {}

  async findUnapprovedUsers(limit: number = 10): Promise<AdminUser[]> {
    return this.adminStore.findUnapprovedUsers(limit);
  }

  async findAllUsers(limit: number = 10): Promise<UserListItem[]> {
    return this.adminStore.findAllUsers(limit);
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
    await this.findMutableUser(username, callerRole);
    await this.adminStore.setRole(username, role);
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

  async restoreUser(username: string): Promise<void> {
    const deleted = await this.adminStore.findDeletedByUsername(username);
    if (!deleted) throw new NotFoundException(`Удалённый пользователь ${username} не найден`);

    await this.adminStore.restoreUser(username);
  }

  private async findMutableUser(username: string, callerRole: string): Promise<AdminUser> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) throw new NotFoundException(`Пользователь ${username} не найден`);

    const callerLevel = ROLE_HIERARCHY.indexOf(callerRole as (typeof ROLE_HIERARCHY)[number]);
    const targetLevel = ROLE_HIERARCHY.indexOf(user.role as (typeof ROLE_HIERARCHY)[number]);

    if (callerLevel < 0 || targetLevel < 0 || callerLevel <= targetLevel) {
      throw new ForbiddenException(
        "Невозможно изменить пользователя с равной или более высокой ролью",
      );
    }

    return user;
  }
}
