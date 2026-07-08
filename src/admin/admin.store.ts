export const AdminMapStoreToken = Symbol("AdminMapStore");

export interface AdminUser {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

export interface IAdminStore {
  findByUsername(username: string): Promise<AdminUser | undefined>;
  findUnapprovedUsers(limit: number): Promise<AdminUser[]>;
  findAllUsers(limit: number): Promise<AdminUser[]>;
  setApproved(username: string, approved: boolean): Promise<void>;
  setBanned(username: string, banned: boolean): Promise<void>;
}

export class AdminMapStore implements IAdminStore {
  private readonly users = new Map<string, AdminUser>();

  async findByUsername(username: string): Promise<AdminUser | undefined> {
    return this.users.get(username);
  }

  async saveUser(user: AdminUser): Promise<void> {
    this.users.set(user.username, user);
  }

  async findUnapprovedUsers(limit: number): Promise<AdminUser[]> {
    const result: AdminUser[] = [];
    for (const user of this.users.values()) {
      if (!user.approved) {
        result.push(user);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  async findAllUsers(limit: number): Promise<AdminUser[]> {
    const result: AdminUser[] = [];
    for (const user of this.users.values()) {
      result.push(user);
      if (result.length >= limit) break;
    }
    return result;
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const user = this.users.get(username);
    if (user) user.approved = approved;
  }

  async setBanned(username: string, banned: boolean): Promise<void> {
    const user = this.users.get(username);
    if (user) user.banned = banned;
  }
}
