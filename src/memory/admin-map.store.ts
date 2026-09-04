import { Injectable } from "@nestjs/common";
import type {
  AdminUser,
  DeletedUser,
  DeletedUsersPage,
  IAdminStore,
  UsersFilter,
  UsersPage,
} from "../admin/admin.store";
import type { MemoryDb } from "./memory-db";

function userMatchesFilter(user: AdminUser, filter: UsersFilter): boolean {
  if (filter.approved !== undefined && user.approved !== filter.approved) {
    return false;
  }

  const { username } = filter;
  if (username !== undefined && !user.username.toLowerCase().startsWith(username.toLowerCase())) {
    return false;
  }

  return true;
}

function compareByUsername(left: AdminUser, right: AdminUser): number {
  if (left.username < right.username) return -1;
  if (left.username > right.username) return 1;
  return 0;
}

@Injectable()
export class AdminMapStore implements IAdminStore {
  constructor(private readonly db: MemoryDb) {}

  async findByUsername(username: string): Promise<AdminUser | undefined> {
    return this.db.users.get(username);
  }

  async saveUser(user: AdminUser): Promise<void> {
    const existing = this.db.users.get(user.username);
    this.db.users.set(user.username, {
      ...user,
      passwordHash: existing?.passwordHash ?? "",
      skin: existing?.skin ?? null,
    });
  }

  async findUnapprovedUsers(limit: number): Promise<AdminUser[]> {
    const result: AdminUser[] = [];
    for (const user of this.db.users.values()) {
      if (!user.approved) {
        result.push(user);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  async findAllUsers(limit: number): Promise<AdminUser[]> {
    const result: AdminUser[] = [];
    for (const user of this.db.users.values()) {
      result.push(user);
      if (result.length >= limit) break;
    }
    return result;
  }

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    const matched: AdminUser[] = [];
    for (const user of this.db.users.values()) {
      if (!userMatchesFilter(user, filter)) continue;
      matched.push(user);
    }

    const sorted = matched.toSorted(compareByUsername);
    return {
      items: sorted.slice(filter.offset, filter.offset + filter.limit),
      total: sorted.length,
    };
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const user = this.db.users.get(username);
    if (user) user.approved = approved;
  }

  async setBanned(username: string, banned: boolean): Promise<void> {
    const user = this.db.users.get(username);
    if (user) user.banned = banned;
  }

  async setRole(username: string, role: string): Promise<void> {
    const user = this.db.users.get(username);
    if (user) user.role = role;
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = this.db.users.get(username);
    if (!user) return undefined;

    this.db.users.delete(username);
    this.db.deletedUsers.set(username, { ...user, deletedAt: new Date() });
    this.cleanupOldDeleted();
    return user;
  }

  async findDeletedUsers(limit: number): Promise<DeletedUser[]> {
    const result: DeletedUser[] = [];
    for (const user of this.db.deletedUsers.values()) {
      result.push(user);
      if (result.length >= limit) break;
    }
    return result;
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    const matched: DeletedUser[] = [];
    for (const user of this.db.deletedUsers.values()) {
      if (!userMatchesFilter(user, filter)) continue;
      matched.push(user);
    }

    const sorted = matched.toSorted(compareByUsername);
    return {
      items: sorted.slice(filter.offset, filter.offset + filter.limit),
      total: sorted.length,
    };
  }

  async findDeletedByUsername(username: string): Promise<DeletedUser | undefined> {
    return this.db.deletedUsers.get(username);
  }

  async restoreUser(username: string): Promise<void> {
    const deleted = this.db.deletedUsers.get(username);
    if (!deleted) return;

    const { deletedAt: _, ...user } = deleted;
    this.db.users.set(username, user);
    this.db.deletedUsers.delete(username);
  }

  async hasOwner(): Promise<boolean> {
    for (const user of this.db.users.values()) {
      if (user.role === "owner") return true;
    }
    return false;
  }

  private cleanupOldDeleted(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [username, user] of this.db.deletedUsers) {
      if (user.deletedAt.getTime() < cutoff) {
        this.db.deletedUsers.delete(username);
      }
    }
  }
}
