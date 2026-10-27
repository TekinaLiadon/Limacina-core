import { Injectable } from "@nestjs/common";
import {
  selectQuery,
  updateQuery,
  setSoftDeletedQuery,
  insertQuery,
  execute,
  toBoolean,
  TABLES,
  type SelectBuilder,
  type SqlValue,
} from "../utils/sql";
import { parseInstallIdHistory, toInstallIdList } from "../auth/install-id";
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

interface InstallIdRow extends Record<string, unknown> {
  user_uuid: string;
  install_id: string;
  install_id_history: string;
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

  const { installId } = filter;
  if (installId !== undefined) {
    placeholders += 1;
    chained = chained.where(
      `EXISTS (SELECT 1 FROM ${TABLES.user_install_ids} ui WHERE ui.user_uuid = ${TABLES.users}.uuid AND (ui.install_id LIKE $${placeholders} OR ui.install_id_history LIKE $${placeholders}))`,
      `%${escapeLikePattern(installId.toLowerCase())}%`,
    );
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
    const { rows, total } = await this.queryUserRows<UserRow>(filter, false, [
      "uuid",
      "username",
      "role",
      "approved",
      "banned",
    ]);
    const installIds = await this.findInstallIdsByUuids(rows.map((row) => row.uuid));

    return {
      items: rows.map((row) => ({
        ...toAdminUser(row),
        installIds: installIds.get(row.uuid) ?? [],
      })),
      total,
    };
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    const { rows, total } = await this.queryUserRows<DeletedUserRow>(filter, true, [
      "uuid",
      "username",
      "role",
      "approved",
      "banned",
      "deleted_at",
    ]);

    return { items: rows.map(toDeletedUser), total };
  }

  private async queryUserRows<Row extends Record<string, unknown>>(
    filter: UsersFilter,
    deleted: boolean,
    columns: string[],
  ): Promise<{ rows: Row[]; total: number }> {
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

    return { rows, total };
  }

  private async findInstallIdsByUuids(uuids: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (uuids.length === 0) return result;

    const placeholders = uuids.map((_, index) => `$${index + 1}`).join(", ");
    const query = selectQuery("user_uuid", "install_id", "install_id_history")
      .from(TABLES.user_install_ids)
      .where(`user_uuid IN (${placeholders})`, ...uuids)
      .build();
    const { rows } = await execute<InstallIdRow>(query.sql, query.values);

    for (const row of rows) {
      const installIds = toInstallIdList({
        current: row.install_id,
        history: parseInstallIdHistory(row.install_id_history),
      });
      result.set(row.user_uuid, installIds);
    }
    return result;
  }

  async setApproved(username: string, approved: boolean, expectedRole?: string): Promise<boolean> {
    return this.updateLiveUser("approved", approved, username, expectedRole);
  }

  async setBanned(username: string, banned: boolean, expectedRole?: string): Promise<boolean> {
    return this.updateLiveUser("banned", banned, username, expectedRole);
  }

  async setRole(username: string, role: string, expectedRole?: string): Promise<boolean> {
    return this.updateLiveUser("role", role, username, expectedRole);
  }

  private async updateLiveUser(
    column: string,
    value: boolean | string,
    username: string,
    expectedRole?: string,
  ): Promise<boolean> {
    const guardValues: SqlValue[] =
      expectedRole !== undefined ? [username, expectedRole] : [username];
    const query = updateQuery()
      .from(TABLES.users)
      .set(column, value)
      .where(
        expectedRole !== undefined
          ? "username = $1 AND deleted = false AND role = $2"
          : "username = $1 AND deleted = false",
        ...guardValues,
      )
      .build();
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, username, expectedRole);
  }

  private async appliedToLiveUser(
    affected: number,
    username: string,
    expectedRole?: string,
  ): Promise<boolean> {
    if (affected > 0) return true;
    const user = await this.findByUsername(username);
    if (!user) return false;
    return expectedRole === undefined || user.role === expectedRole;
  }

  async deleteUser(username: string, expectedRole?: string): Promise<AdminUser | undefined> {
    const guardValues: SqlValue[] =
      expectedRole !== undefined ? [username, expectedRole] : [username];
    const query = updateQuery()
      .from(TABLES.users)
      .set("deleted", true)
      .set("deleted_at", new Date())
      .where(
        expectedRole !== undefined
          ? "username = $1 AND deleted = false AND role = $2"
          : "username = $1 AND deleted = false",
        ...guardValues,
      )
      .build();
    const { count } = await execute(query.sql, query.values);
    if (count === 0) return undefined;
    return this.findDeletedUserView(username);
  }

  private async findDeletedUserView(username: string): Promise<AdminUser | undefined> {
    const deleted = await this.findDeletedByUsername(username);
    if (!deleted) return undefined;
    const { uuid, username: deletedUsername, role, approved, banned } = deleted;
    return { uuid, username: deletedUsername, role, approved, banned };
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
