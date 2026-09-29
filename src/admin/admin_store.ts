import { Optional } from "@nestjs/common";

import { MemoryDb, type MemoryUserRecord } from "../memory/memory-db";

export const AdminMapStoreToken = Symbol("AdminMapStore");

export const DELETED_USERS_RETENTION_DAYS = 30;

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

export interface UsersFilter {
  limit: number;
  offset: number;
  username?: string | undefined;
  approved?: boolean | undefined;
}

export interface UsersPage {
  items: AdminUser[];
  total: number;
}

export interface DeletedUsersPage {
  items: DeletedUser[];
  total: number;
}

export interface IAdminStore {
  findByUsername(username: string): Promise<AdminUser | undefined>;
  saveUser(user: AdminUser): Promise<void>;
  searchUsers(filter: UsersFilter): Promise<UsersPage>;
  searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage>;
  setApproved(username: string, approved: boolean): Promise<boolean>;
  setBanned(username: string, banned: boolean): Promise<boolean>;
  setRole(username: string, role: string): Promise<boolean>;
  deleteUser(username: string): Promise<AdminUser | undefined>;
  findDeletedByUsername(username: string): Promise<DeletedUser | undefined>;
  restoreUser(username: string): Promise<void>;
  removeDeletedDuplicates(username: string): Promise<number>;
  purgeOldDeletedUsers(retentionDays: number): Promise<number>;
  hasOwner(): Promise<boolean>;
}

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
  const leftKey = left.username.toLowerCase();
  const rightKey = right.username.toLowerCase();
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  if (left.username < right.username) return -1;
  if (left.username > right.username) return 1;
  return 0;
}

function toDeletedUser(user: AdminUser, deletedAt: Date): DeletedUser {
  return { ...user, deletedAt };
}

function deletedUserView(user: MemoryUserRecord): DeletedUser | undefined {
  if (user.deletedAt === null) return undefined;
  return toDeletedUser(user, user.deletedAt);
}

function toAdminView(user: MemoryUserRecord): AdminUser {
  return {
    uuid: user.uuid,
    username: user.username,
    role: user.role,
    approved: user.approved,
    banned: user.banned,
  };
}

export class AdminMapStore implements IAdminStore {
  private readonly users: Map<string, MemoryUserRecord>;

  constructor(@Optional() db: MemoryDb = new MemoryDb()) {
    this.users = db.users;
  }

  async findByUsername(username: string): Promise<AdminUser | undefined> {
    const user = this.liveUser(username);
    if (!user) return undefined;
    return toAdminView(user);
  }

  async saveUser(user: AdminUser): Promise<void> {
    const existing = this.users.get(user.uuid);
    const next: MemoryUserRecord = {
      uuid: user.uuid,
      username: user.username,
      passwordHash: existing?.passwordHash ?? "",
      role: user.role,
      approved: user.approved,
      banned: user.banned,
      deleted: false,
      deletedAt: null,
      passwordChangedAt: existing?.passwordChangedAt,
    };
    this.users.set(user.uuid, next);
  }

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    return this.searchUserRecords(filter, false, toAdminView);
  }

  async setApproved(username: string, approved: boolean): Promise<boolean> {
    const user = this.liveUser(username);
    if (!user) return false;
    user.approved = approved;
    return true;
  }

  async setBanned(username: string, banned: boolean): Promise<boolean> {
    const user = this.liveUser(username);
    if (!user) return false;
    user.banned = banned;
    return true;
  }

  async setRole(username: string, role: string): Promise<boolean> {
    const user = this.liveUser(username);
    if (!user) return false;
    user.role = role;
    return true;
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = this.liveUser(username);
    if (!user) return undefined;

    user.deleted = true;
    user.deletedAt = new Date();
    return toAdminView(user);
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    return this.searchUserRecords(filter, true, deletedUserView);
  }

  private searchUserRecords<View extends AdminUser>(
    filter: UsersFilter,
    deleted: boolean,
    toView: (user: MemoryUserRecord) => View | undefined,
  ): { items: View[]; total: number } {
    const matched: View[] = [];
    for (const user of this.users.values()) {
      if (user.deleted !== deleted) continue;
      if (!userMatchesFilter(user, filter)) continue;
      const view = toView(user);
      if (!view) continue;
      matched.push(view);
    }

    const sorted = matched.toSorted(compareByUsername);
    return {
      items: sorted.slice(filter.offset, filter.offset + filter.limit),
      total: sorted.length,
    };
  }

  async findDeletedByUsername(username: string): Promise<DeletedUser | undefined> {
    const user = this.newestDeletedUser(username);
    if (!user || user.deletedAt === null) return undefined;
    return toDeletedUser(user, user.deletedAt);
  }

  async restoreUser(username: string): Promise<void> {
    const user = this.newestDeletedUser(username);
    if (!user) return;

    user.deleted = false;
    user.deletedAt = null;
  }

  async removeDeletedDuplicates(username: string): Promise<number> {
    let removed = 0;
    for (const [uuid, user] of this.users) {
      if (user.username !== username || !user.deleted) continue;
      this.users.delete(uuid);
      removed += 1;
    }
    return removed;
  }

  async purgeOldDeletedUsers(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let purged = 0;
    for (const [uuid, user] of this.users) {
      if (!user.deleted || user.deletedAt === null) continue;
      if (user.deletedAt.getTime() >= cutoff) continue;
      this.users.delete(uuid);
      purged += 1;
    }
    return purged;
  }

  async hasOwner(): Promise<boolean> {
    for (const user of this.users.values()) {
      if (user.role === "owner" && !user.deleted) return true;
    }
    return false;
  }

  private liveUser(username: string): MemoryUserRecord | undefined {
    for (const user of this.users.values()) {
      if (user.username === username && !user.deleted) return user;
    }
    return undefined;
  }

  private newestDeletedUser(username: string): MemoryUserRecord | undefined {
    let newest: MemoryUserRecord | undefined;
    for (const user of this.users.values()) {
      if (user.username !== username || !user.deleted) continue;
      if (!newest || (user.deletedAt ?? 0) > (newest.deletedAt ?? 0)) newest = user;
    }
    return newest;
  }
}
