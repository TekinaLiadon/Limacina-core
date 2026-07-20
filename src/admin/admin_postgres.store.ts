import { Injectable } from "@nestjs/common";
import { selectQuery, insertQuery, updateQuery, deleteQuery, execute, TABLES } from "../utils/sql";
import type { IAdminStore, AdminUser, DeletedUser } from "./admin.store";
import type { UserRow } from "./dto/dto";

interface DeletedUserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  password_hash: string;
  skin_url: string | null;
  role: string;
  approved: boolean;
  banned: boolean;
  deleted_at: Date;
}

@Injectable()
export class AdminPostgresStore implements IAdminStore {
  async findByUsername(username: string): Promise<AdminUser | undefined> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned")
      .from(TABLES.users)
      .where("username = $1", username)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    const row = rows[0];
    if (!row) return undefined;

    return {
      uuid: row.uuid,
      username: row.username,
      role: row.role,
      approved: row.approved,
      banned: row.banned,
    };
  }

  async saveUser(user: AdminUser): Promise<void> {
    const existing = await this.findByUsername(user.username);
    if (existing) {
      const query = updateQuery()
        .from(TABLES.users)
        .set("role", user.role)
        .set("approved", user.approved)
        .set("banned", user.banned)
        .where("username = $1", user.username)
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

  async findUnapprovedUsers(limit: number): Promise<AdminUser[]> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned")
      .from(TABLES.users)
      .where("approved = $1", false)
      .limit(limit)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.map((row) => ({
      uuid: row.uuid,
      username: row.username,
      role: row.role,
      approved: row.approved,
      banned: row.banned,
    }));
  }

  async findAllUsers(limit: number): Promise<AdminUser[]> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned")
      .from(TABLES.users)
      .limit(limit)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.map((row) => ({
      uuid: row.uuid,
      username: row.username,
      role: row.role,
      approved: row.approved,
      banned: row.banned,
    }));
  }

  async setApproved(username: string, approved: boolean): Promise<void> {
    const query = updateQuery()
      .from(TABLES.users)
      .set("approved", approved)
      .where("username = $1", username)
      .build();

    await execute(query.sql, query.values);
  }

  async setBanned(username: string, banned: boolean): Promise<void> {
    const query = updateQuery()
      .from(TABLES.users)
      .set("banned", banned)
      .where("username = $1", username)
      .build();

    await execute(query.sql, query.values);
  }

  async setRole(username: string, role: string): Promise<void> {
    const query = updateQuery()
      .from(TABLES.users)
      .set("role", role)
      .where("username = $1", username)
      .build();

    await execute(query.sql, query.values);
  }

  async deleteUser(username: string): Promise<AdminUser | undefined> {
    const user = await this.findByUsername(username);
    if (!user) return undefined;

    const userRow = await this.findFullUser(username);
    if (!userRow) return undefined;

    const removeExisting = deleteQuery()
      .from(TABLES.deleted_users)
      .where("username = $1", username)
      .build();
    await execute(removeExisting.sql, removeExisting.values);

    const insert = insertQuery(
      "uuid",
      "username",
      "password_hash",
      "skin_url",
      "role",
      "approved",
      "banned",
    )
      .from(TABLES.deleted_users)
      .values(
        userRow.uuid,
        userRow.username,
        userRow.password_hash,
        userRow.skin_url,
        userRow.role,
        userRow.approved,
        userRow.banned,
      )
      .build();

    await execute(insert.sql, insert.values);

    const del = deleteQuery().from(TABLES.users).where("username = $1", username).build();
    await execute(del.sql, del.values);

    this.cleanupOldDeleted();

    return user;
  }

  async findDeletedUsers(limit: number): Promise<DeletedUser[]> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned", "deleted_at")
      .from(TABLES.deleted_users)
      .limit(limit)
      .build();

    const { rows } = await execute<DeletedUserRow>(query.sql, query.values);
    return rows.map((row) => ({
      uuid: row.uuid,
      username: row.username,
      role: row.role,
      approved: row.approved,
      banned: row.banned,
      deletedAt: new Date(row.deleted_at),
    }));
  }

  async findDeletedByUsername(username: string): Promise<DeletedUser | undefined> {
    const query = selectQuery("uuid", "username", "role", "approved", "banned", "deleted_at")
      .from(TABLES.deleted_users)
      .where("username = $1", username)
      .build();

    const { rows } = await execute<DeletedUserRow>(query.sql, query.values);
    const row = rows[0];
    if (!row) return undefined;

    return {
      uuid: row.uuid,
      username: row.username,
      role: row.role,
      approved: row.approved,
      banned: row.banned,
      deletedAt: new Date(row.deleted_at),
    };
  }

  async restoreUser(username: string): Promise<void> {
    const deleted = await this.findDeletedByUsername(username);
    if (!deleted) return;

    const fullDeleted = await this.findFullDeletedUser(username);
    if (!fullDeleted) return;

    const userInsert = insertQuery(
      "uuid",
      "username",
      "password_hash",
      "role",
      "approved",
      "banned",
    )
      .from(TABLES.users)
      .values(
        fullDeleted.uuid,
        fullDeleted.username,
        fullDeleted.password_hash,
        fullDeleted.role,
        fullDeleted.approved,
        fullDeleted.banned,
      )
      .build();

    await execute(userInsert.sql, userInsert.values);

    if (fullDeleted.skin_url) {
      const textureInsert = insertQuery("uuid", "skin_url")
        .from(TABLES.user_textures)
        .values(fullDeleted.uuid, fullDeleted.skin_url)
        .build();

      await execute(textureInsert.sql, textureInsert.values);
    }

    const del = deleteQuery().from(TABLES.deleted_users).where("username = $1", username).build();
    await execute(del.sql, del.values);
  }

  async hasOwner(): Promise<boolean> {
    const query = selectQuery("1").from(TABLES.users).where("role = $1", "owner").limit(1).build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.length > 0;
  }

  private async findFullUser(username: string): Promise<DeletedUserRow | undefined> {
    const query = selectQuery(
      "u.uuid",
      "u.username",
      "u.password_hash",
      "t.skin_url",
      "u.role",
      "u.approved",
      "u.banned",
    )
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid")
      .where("u.username = $1", username)
      .build();

    const { rows } = await execute<DeletedUserRow>(query.sql, query.values);
    return rows[0];
  }

  private async findFullDeletedUser(username: string): Promise<DeletedUserRow | undefined> {
    const query = selectQuery(
      "uuid",
      "username",
      "password_hash",
      "skin_url",
      "role",
      "approved",
      "banned",
      "deleted_at",
    )
      .from(TABLES.deleted_users)
      .where("username = $1", username)
      .build();

    const { rows } = await execute<DeletedUserRow>(query.sql, query.values);
    return rows[0];
  }

  private cleanupOldDeleted(): void {
    const query = deleteQuery()
      .from(TABLES.deleted_users)
      .where("deleted_at < now() - INTERVAL '30 days'")
      .build();
    execute(query.sql, query.values);
  }
}
