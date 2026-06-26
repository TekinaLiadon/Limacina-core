import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AdminMapStoreToken, type IAdminStore } from "./admin.store";
import type { StoredUser } from "../auth/service/auth_store.service";

@Injectable()
export class AdminService {
  constructor(@Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore) {}

  async findUnapprovedUsers(limit: number = 10): Promise<StoredUser[]> {
    return this.adminStore.findUnapprovedUsers(limit);
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) throw new NotFoundException(`Пользователь ${username} не найден`);

    await this.adminStore.setApproved(username, approved);
  }
}
