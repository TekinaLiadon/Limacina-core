import type { StoredUser } from "../auth/service/auth_store.service";

export const AdminMapStoreToken = Symbol("AdminMapStore");

export interface IAdminStore {
  findByUsername(username: string): Promise<StoredUser | undefined>;
  findUnapprovedUsers(limit: number): Promise<StoredUser[]>;
  setApproved(username: string, approved: boolean): Promise<void>;
}

export class AdminMapStore implements IAdminStore {
  private readonly users = new Map<string, StoredUser>();

  async findByUsername(username: string): Promise<StoredUser | undefined> {
    return this.users.get(username);
  }

  async saveUser(user: StoredUser): Promise<void> {
    this.users.set(user.username, user);
  }

  async findUnapprovedUsers(limit: number): Promise<StoredUser[]> {
    const result: StoredUser[] = [];
    for (const user of this.users.values()) {
      if (!user.approved) {
        result.push(user);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const user = this.users.get(username);
    if (user) {
      user.approved = approved;
    }
  }
}
