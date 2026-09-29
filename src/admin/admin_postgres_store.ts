import { Injectable } from "@nestjs/common";
import {
  selectQuery,
  updateQuery,
  updateColumnQuery,
  setSoftDeletedQuery,
  insertQuery,
  execute,
  toBoolean,
  TABLES,
  type SelectBuilder,
} from "../utils/sql";
import type {
  IAdminStore,
  AdminUser,
  DeletedUser,
  UsersFilter,
  UsersPage,
  DeletedUsersPage,
} from "./admin_store";

interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
}

interface DeletedUserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  role: string;
  approved: boolean;
  banned: boolean;
  deleted_at: Date;
}

interface CountRow extends Record<string, unknown> {
  total: string | number;
}

function toAdminUser(row: UserRow): AdminUser {
  return {
    uuid: row.uuid,
    username: row.username,
    role: row.role,
    approved: toBoolean(row.approved),
    banned: toBoolean(row.banned),
  };
}

function toDeletedUser(row: DeletedUserRow): DeletedUser {
  return {
    uuid: row.uuid,
    username: row.username,
    role: row.role,
    approved: toBoolean(row.approved),
    banned: toBoolean(row.banned),
    deletedAt: new Date(row.deleted_at),
  };
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function withUsersFilter(query: SelectBuilder, filter: UsersFilter): SelectBuilder {
  let chained = query;
  let placeholders = 0;

  const { username } = filter;
  if (username !== undefined) {
    placeholders += 1;
    chained = chained.where(
      `lower(username) LIKE $${placeholders}`,
      `${escapeLikePattern(username.toLowerCase())}%`,
    );
  }

  const { approved } = filter;
  if (approved !== undefined) {
    placeholders += 1;
    chained = chained.where(`approved = $${placeholders}`, approved);
  }

  return chained;
}

@Injectable()
export class AdminPostgresStore implements IAdminStore {
  async findByUsername(username: string): Promise<AdminUser | undefined> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned")
      .from(TABLES.users)
      .where("username = $1", username)
      .where("deleted = false")
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    const [row] = rows;
    if (!row) return undefined;

    return toAdminUser(row);
  }

  async saveUser(user: AdminUser): Promise<void> {
    const existing = await this.findByUsername(user.username);
    if (existing) {
      const query = updateQuery()
        .from(TABLES.users)
        .set("uuid", user.uuid)
        .set("role", user.role)
        .set("approved", user.approved)
        .set("banned", user.banned)
        .where("username = $1 AND deleted = false", user.username)
        .build();
      await execute(query.sql, query.values);
      return;
    }

    const query = insertQuery("uuid", "username", "role", "approved", "banned")
      .from(TABLES.users)
      .values(user.uuid, user.username, user.role, user.approved, user.banned)
      .build();
    await execute(query.sql, query.values);
  }

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    return this.searchUsersPage(
      filter,
      false,
      ["uuid", "username", "role", "approved", "banned"],
      toAdminUser,
    );
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    return this.searchUsersPage(
      filter,
      true,
      ["uuid", "username", "role", "approved", "banned", "deleted_at"],
      toDeletedUser,
    );
  }

  private async searchUsersPage<Row extends Record<string, unknown>, View>(
    filter: UsersFilter,
    deleted: boolean,
    columns: string[],
    mapRow: (row: Row) => View,
  ): Promise<{ items: View[]; total: number }> {
    const deletedClause = deleted ? "deleted = true" : "deleted = false";
    const itemsQuery = withUsersFilter(
      selectQuery(...columns)
        .from(TABLES.users)
        .where(deletedClause),
      filter,
    )
      .orderBy("lower(username)")
      .orderBy("username")
      .limit(filter.limit)
      .offset(filter.offset)
      .build();
    const { rows } = await execute<Row>(itemsQuery.sql, itemsQuery.values);

    const countQuery = withUsersFilter(
      selectQuery("count(*) AS total").from(TABLES.users).where(deletedClause),
      filter,
    ).build();
    const { rows: countRows } = await execute<CountRow>(countQuery.sql, countQuery.values);
    const [countRow] = countRows;
    const total = countRow ? Number(countRow.total) : 0;

    return {
      items: rows.map(mapRow),
      total,
    };
  }

  async setApproved(username: string, approved: boolean): Promise<boolean> {
    const query = updateColumnQuery(
      TABLES.users,
      "approved",
      approved,
      "username = $1 AND deleted = false",
      username,
    );
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, username);
  }

  async setBanned(username: string, banned: boolean): Promise<boolean> {
    const query = updateColumnQuery(
      TABLES.users,
      "banned",
      banned,
      "username = $1 AND deleted = false",
      username,
    );
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, username);
  }

  async setRole(username: string, role: string): Promise<boolean> {
    const query = updateColumnQuery(
      TABLES.users,
      "role",
      role,
      "username = $1 AND deleted = false",
      username,
    );
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, username);
  }

  private async appliedToLiveUser(affected: number, username: string): Promise<boolean> {
    if (affected > 0) return true;
    return (await this.findByUsername(username)) !== undefined;
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = await this.findByUsername(username);
    if (!user) return undefined;

    const query = setSoftDeletedQuery(TABLES.users, "username = $1", username, true);
    await execute(query.sql, query.values);
    return user;
  }

  async findDeletedByUsername(username: string): Promise<DeletedUser | undefined> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned", "deleted_at")
      .from(TABLES.users)
      .where("username = $1", username)
      .where("deleted = true")
      .orderBy("deleted_at", "desc")
      .limit(1)
      .build();

    const { rows } = await execute<DeletedUserRow>(query.sql, query.values);
    const [row] = rows;
    if (!row) return undefined;

    return toDeletedUser(row);
  }

  async restoreUser(username: string): Promise<void> {
    const deleted = await this.findDeletedByUsername(username);
    if (!deleted) return;

    const query = setSoftDeletedQuery(
      TABLES.users,
      "uuid = (SELECT uuid FROM users WHERE username = $1 AND deleted = true ORDER BY deleted_at DESC LIMIT 1)",
      username,
      false,
    );
    await execute(query.sql, query.values);
  }

  async removeDeletedDuplicates(username: string): Promise<number> {
    const { count } = await execute(
      `DELETE FROM ${TABLES.users} WHERE username = $1 AND deleted = true RETURNING uuid`,
      [username],
    );
    return count;
  }

  async purgeOldDeletedUsers(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const { count } = await execute(
      `DELETE FROM ${TABLES.users} WHERE deleted = true AND deleted_at < $1 RETURNING uuid`,
      [cutoff],
    );
    return count;
  }

  async hasOwner(): Promise<boolean> {
    const query = selectQuery("1")
      .from(TABLES.users)
      .where("role = $1", "owner")
      .where("deleted = false")
      .limit(1)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.length > 0;
  }
}
