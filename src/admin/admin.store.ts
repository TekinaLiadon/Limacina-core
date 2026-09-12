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
  setApproved(username: string, approved: boolean): Promise<void>;
  setBanned(username: string, banned: boolean): Promise<void>;
  setRole(username: string, role: string): Promise<void>;
  deleteUser(username: string): Promise<AdminUser | undefined>;
  findDeletedByUsername(username: string): Promise<DeletedUser | undefined>;
  restoreUser(username: string): Promise<void>;
  purgeOldDeletedUsers(retentionDays: number): Promise<number>;
  hasOwner(): Promise<boolean>;
}

interface StoredAdminUser extends AdminUser {
  deleted: boolean;
  deletedAt: Date | null;
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

function toAdminView(user: StoredAdminUser): AdminUser {
  return {
    uuid: user.uuid,
    username: user.username,
    role: user.role,
    approved: user.approved,
    banned: user.banned,
  };
}

export class AdminMapStore implements IAdminStore {
  private readonly users = new Map<string, StoredAdminUser>();

  async findByUsername(username: string): Promise<AdminUser | undefined> {
    const user = this.liveUser(username);
    if (!user) return undefined;
    return toAdminView(user);
  }

  async saveUser(user: AdminUser): Promise<void> {
    this.users.set(user.uuid, { ...user, deleted: false, deletedAt: null });
  }

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    const matched: AdminUser[] = [];
    for (const user of this.users.values()) {
      if (user.deleted || !userMatchesFilter(user, filter)) continue;
      matched.push(toAdminView(user));
    }

    const sorted = matched.toSorted(compareByUsername);
    return {
      items: sorted.slice(filter.offset, filter.offset + filter.limit),
      total: sorted.length,
    };
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const user = this.liveUser(username);
    if (user) user.approved = approved;
  }

  async setBanned(username: string, banned: boolean): Promise<void> {
    const user = this.liveUser(username);
    if (user) user.banned = banned;
  }

  async setRole(username: string, role: string): Promise<void> {
    const user = this.liveUser(username);
    if (user) user.role = role;
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = this.liveUser(username);
    if (!user) return undefined;

    user.deleted = true;
    user.deletedAt = new Date();
    return toAdminView(user);
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    const matched: DeletedUser[] = [];
    for (const user of this.users.values()) {
      if (!user.deleted || user.deletedAt === null) continue;
      if (!userMatchesFilter(user, filter)) continue;
      matched.push(toDeletedUser(user, user.deletedAt));
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
    this.removeStaleDeletedDuplicates(username, user.uuid);
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

  async __test__deleteUser(username: string): Promise<void> {
    for (const [uuid, user] of this.users) {
      if (user.username === username) this.users.delete(uuid);
    }
  }

  private liveUser(username: string): StoredAdminUser | undefined {
    for (const user of this.users.values()) {
      if (user.username === username && !user.deleted) return user;
    }
    return undefined;
  }

  private newestDeletedUser(username: string): StoredAdminUser | undefined {
    let newest: StoredAdminUser | undefined;
    for (const user of this.users.values()) {
      if (user.username !== username || !user.deleted) continue;
      if (!newest || (user.deletedAt ?? 0) > (newest.deletedAt ?? 0)) newest = user;
    }
    return newest;
  }

  private removeStaleDeletedDuplicates(username: string, keptUuid: string): void {
    for (const [uuid, user] of this.users) {
      if (uuid !== keptUuid && user.username === username && user.deleted) {
        this.users.delete(uuid);
      }
    }
  }
}
