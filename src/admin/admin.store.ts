export const AdminMapStoreToken = Symbol("AdminMapStore");

export interface AdminUser {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

export interface DeletedUser extends AdminUser {
  deletedAt: Date;
}

export interface IAdminStore {
  findByUsername(username: string): Promise<AdminUser | undefined>;
  saveUser(user: AdminUser): Promise<void>;
  findUnapprovedUsers(limit: number): Promise<AdminUser[]>;
  findAllUsers(limit: number): Promise<AdminUser[]>;
  setApproved(username: string, approved: boolean): Promise<void>;
  setBanned(username: string, banned: boolean): Promise<void>;
  setRole(username: string, role: string): Promise<void>;
  deleteUser(username: string): Promise<AdminUser | undefined>;
  findDeletedUsers(limit: number): Promise<DeletedUser[]>;
  findDeletedByUsername(username: string): Promise<DeletedUser | undefined>;
  restoreUser(username: string): Promise<void>;
  hasOwner(): Promise<boolean>;
}

export class AdminMapStore implements IAdminStore {
  private readonly users = new Map<string, AdminUser>();
  private readonly deletedUsers = new Map<string, DeletedUser>();

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

  async setRole(username: string, role: string): Promise<void> {
    const user = this.users.get(username);
    if (user) user.role = role;
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = this.users.get(username);
    if (!user) return undefined;

    this.users.delete(username);
    this.deletedUsers.set(username, { ...user, deletedAt: new Date() });
    this.cleanupOldDeleted();
    return user;
  }

  async findDeletedUsers(limit: number): Promise<DeletedUser[]> {
    const result: DeletedUser[] = [];
    for (const user of this.deletedUsers.values()) {
      result.push(user);
      if (result.length >= limit) break;
    }
    return result;
  }

  async findDeletedByUsername(username: string): Promise<DeletedUser | undefined> {
    return this.deletedUsers.get(username);
  }

  async restoreUser(username: string): Promise<void> {
    const deleted = this.deletedUsers.get(username);
    if (!deleted) return;

    const { deletedAt: _, ...user } = deleted;
    this.users.set(username, user);
    this.deletedUsers.delete(username);
  }

  async hasOwner(): Promise<boolean> {
    for (const user of this.users.values()) {
      if (user.role === "owner") return true;
    }
    return false;
  }

  private cleanupOldDeleted(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [username, user] of this.deletedUsers) {
      if (user.deletedAt.getTime() < cutoff) {
        this.deletedUsers.delete(username);
      }
    }
  }
}
