import { Injectable } from "@nestjs/common";
import {
  selectQuery,
  updateQuery,
  insertQuery,
  deleteQuery,
  execute,
  executeInTransaction,
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
} from "./admin.store";
import type { UserRow } from "./dto/dto";

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
    approved: row.approved,
    banned: row.banned,
  };
}

function toDeletedUser(row: DeletedUserRow): DeletedUser {
  return {
    uuid: row.uuid,
    username: row.username,
    role: row.role,
    approved: row.approved,
    banned: row.banned,
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
    const itemsQuery = withUsersFilter(
      selectQuery("uuid", "username", "role", "approved", "banned")
        .from(TABLES.users)
        .where("deleted = false"),
      filter,
    )
      .orderBy("lower(username)")
      .orderBy("username")
      .limit(filter.limit)
      .offset(filter.offset)
      .build();
    const { rows } = await execute<UserRow>(itemsQuery.sql, itemsQuery.values);

    const countQuery = withUsersFilter(
      selectQuery("count(*) AS total").from(TABLES.users).where("deleted = false"),
      filter,
    ).build();
    const { rows: countRows } = await execute<CountRow>(countQuery.sql, countQuery.values);
    const [countRow] = countRows;
    const total = countRow ? Number(countRow.total) : 0;

    return {
      items: rows.map(toAdminUser),
      total,
    };
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    const itemsQuery = withUsersFilter(
      selectQuery("uuid", "username", "role", "approved", "banned", "deleted_at")
        .from(TABLES.users)
        .where("deleted = true"),
      filter,
    )
      .orderBy("lower(username)")
      .orderBy("username")
      .limit(filter.limit)
      .offset(filter.offset)
      .build();
    const { rows } = await execute<DeletedUserRow>(itemsQuery.sql, itemsQuery.values);

    const countQuery = withUsersFilter(
      selectQuery("count(*) AS total").from(TABLES.users).where("deleted = true"),
      filter,
    ).build();
    const { rows: countRows } = await execute<CountRow>(countQuery.sql, countQuery.values);
    const [countRow] = countRows;
    const total = countRow ? Number(countRow.total) : 0;

    return {
      items: rows.map(toDeletedUser),
      total,
    };
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const query = updateQuery()
      .from(TABLES.users)
      .set("approved", approved)
      .where("username = $1 AND deleted = false", username)
      .build();

    await execute(query.sql, query.values);
  }

  async setBanned(username: string, banned: boolean): Promise<void> {
    const query = updateQuery()
      .from(TABLES.users)
      .set("banned", banned)
      .where("username = $1 AND deleted = false", username)
      .build();

    await execute(query.sql, query.values);
  }

  async setRole(username: string, role: string): Promise<void> {
    const query = updateQuery()
      .from(TABLES.users)
      .set("role", role)
      .where("username = $1 AND deleted = false", username)
      .build();

    await execute(query.sql, query.values);
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = await this.findByUsername(username);
    if (!user) return undefined;

    const query = updateQuery()
      .from(TABLES.users)
      .set("deleted", true)
      .set("deleted_at", new Date())
      .where("username = $1 AND deleted = false", username)
      .returning("uuid")
      .build();

    const { rows } = await execute<{ uuid: string }>(query.sql, query.values);
    return rows.length > 0 ? user : undefined;
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

    await executeInTransaction([
      updateQuery()
        .from(TABLES.users)
        .set("deleted", false)
        .set("deleted_at", null)
        .where(
          "uuid = (SELECT uuid FROM users WHERE username = $1 AND deleted = true ORDER BY deleted_at DESC LIMIT 1)",
          username,
        )
        .build(),
      deleteQuery().from(TABLES.users).where("username = $1 AND deleted = true", username).build(),
    ]);
  }

  async purgeOldDeletedUsers(retentionDays: number): Promise<number> {
    const { rows } = await execute<{ uuid: string }>(
      `DELETE FROM ${TABLES.users} ` +
        `WHERE deleted = true AND deleted_at < now() - make_interval(days => $1) ` +
        `RETURNING uuid`,
      [retentionDays],
    );
    return rows.length;
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
