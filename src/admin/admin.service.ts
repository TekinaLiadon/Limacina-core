import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AdminMapStoreToken, type IAdminStore, type AdminUser } from "./admin.store";

export interface UserListItem {
  username: string;
  role: string;
  banned: boolean;
}

@Injectable()
export class AdminService {
  constructor(@Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore) {}

  async findUnapprovedUsers(limit: number = 10): Promise<AdminUser[]> {
    return this.adminStore.findUnapprovedUsers(limit);
  }

  async findAllUsers(limit: number = 10): Promise<UserListItem[]> {
    const users = await this.adminStore.findAllUsers(limit);
    return users.map((u) => ({ username: u.username, role: u.role, banned: u.banned }));
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) throw new NotFoundException(`Пользователь ${username} не найден`);

    await this.adminStore.setApproved(username, approved);
  }

  async setBanned(username: string, banned: boolean): Promise<void> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) throw new NotFoundException(`Пользователь ${username} не найден`);

    await this.adminStore.setBanned(username, banned);
  }
}
