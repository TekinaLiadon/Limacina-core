import { Injectable } from "@nestjs/common";
import {
  insertQuery,
  selectQuery,
  updateQuery,
  deleteQuery,
  updateColumnQuery,
  setSoftDeletedQuery,
  execute,
  executeInTransaction,
  executeInTransactionReturning,
  toBoolean,
  isUniqueViolation,
  TABLES,
} from "../../utils/sql";
import type { IAuthStore, StoredUser, RefreshEntry } from "./auth_store";
import { MAX_REFRESH_TOKENS_PER_USER } from "../token.constants";

interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  password_hash: string;
  role: string;
  approved: boolean;
  banned: boolean;
  password_changed_at: Date | null;
}

interface RefreshRow extends Record<string, unknown> {
  jti: string;
  user_id: string;
  username: string;
}

@Injectable()
export class AuthPostgresStore implements IAuthStore {
  async findByUsername(username: string): Promise<StoredUser | undefined> {
    const query = selectQuery(
      "uuid",
      "username",
      "password_hash",
      "role",
      "approved",
      "banned",
      "password_changed_at",
    )
      .from(TABLES.users)
      .where("username = $1", username)
      .where("deleted = false")
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    const [row] = rows;
    if (!row) return undefined;

    return {
      uuid: row.uuid,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      approved: toBoolean(row.approved),
      banned: toBoolean(row.banned),
      passwordChangedAt: row.password_changed_at ?? undefined,
    };
  }

  async saveUser(user: StoredUser): Promise<boolean> {
    const existing = await this.findByUsername(user.username);
    if (existing) {
      if (existing.uuid !== user.uuid) return false;

      const update = updateQuery()
        .from(TABLES.users)
        .set("password_hash", user.passwordHash)
        .where("uuid = $1", user.uuid)
        .build();
      await execute(update.sql, update.values);
      return true;
    }

    const insertSql = `INSERT INTO ${TABLES.users} (uuid, username, password_hash, role, approved, banned, password_changed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    try {
      await execute(insertSql, [
        user.uuid,
        user.username,
        user.passwordHash,
        user.role,
        user.approved,
        user.banned,
        user.passwordChangedAt ?? null,
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
    return true;
  }

  async setApproved(uuid: string, approved: boolean): Promise<boolean> {
    const query = updateColumnQuery(
      TABLES.users,
      "approved",
      approved,
      "uuid = $1 AND deleted = false",
      uuid,
    );
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, uuid);
  }

  async setBanned(uuid: string, banned: boolean): Promise<boolean> {
    const query = updateColumnQuery(
      TABLES.users,
      "banned",
      banned,
      "uuid = $1 AND deleted = false",
      uuid,
    );
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, uuid);
  }

  async userExists(username: string): Promise<boolean> {
    const query = selectQuery("1")
      .from(TABLES.users)
      .where("lower(username) = lower($1)", username)
      .where("deleted = false")
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.length > 0;
  }

  async replacePassword(
    uuid: string,
    passwordHash: string,
    changedAt: Date,
    keepRefreshJti?: string,
  ): Promise<void> {
    await executeInTransaction([
      updateQuery()
        .from(TABLES.users)
        .set("password_hash", passwordHash)
        .set("password_changed_at", changedAt)
        .where("uuid = $1", uuid)
        .build(),
      keepRefreshJti
        ? deleteQuery()
            .from(TABLES.refresh_tokens)
            .where("user_id = $1 AND jti <> $2", uuid, keepRefreshJti)
            .build()
        : deleteQuery().from(TABLES.refresh_tokens).where("user_id = $1", uuid).build(),
    ]);
  }

  async updateRole(uuid: string, role: string): Promise<boolean> {
    const query = updateColumnQuery(
      TABLES.users,
      "role",
      role,
      "uuid = $1 AND deleted = false",
      uuid,
    );
    const { count } = await execute(query.sql, query.values);
    return this.appliedToLiveUser(count, uuid);
  }

  private async appliedToLiveUser(affected: number, uuid: string): Promise<boolean> {
    if (affected > 0) return true;
    const query = selectQuery("1")
      .from(TABLES.users)
      .where("uuid = $1", uuid)
      .where("deleted = false")
      .limit(1)
      .build();
    const { rows } = await execute(query.sql, query.values);
    return rows.length > 0;
  }

  async deleteUser(uuid: string): Promise<void> {
    const query = setSoftDeletedQuery(TABLES.users, "uuid = $1", uuid, true);
    await execute(query.sql, query.values);
  }

  async restoreUser(uuid: string): Promise<void> {
    const query = setSoftDeletedQuery(TABLES.users, "uuid = $1", uuid, false);
    await execute(query.sql, query.values);
  }

  async saveRefresh(jti: string, entry: RefreshEntry, expiresAt: Date): Promise<void> {
    await executeInTransaction([
      insertQuery("jti", "user_id", "username", "expires_at")
        .from(TABLES.refresh_tokens)
        .values(jti, entry.userId, entry.username, expiresAt)
        .build(),
      deleteQuery().from(TABLES.refresh_tokens).where("expires_at <= now()").build(),
      deleteQuery()
        .from(TABLES.refresh_tokens)
        .where(
          "user_id = $1 AND jti NOT IN (SELECT jti FROM (SELECT jti FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2) AS recent)",
          entry.userId,
          MAX_REFRESH_TOKENS_PER_USER,
        )
        .build(),
    ]);
  }

  async claimRefresh(jti: string): Promise<RefreshEntry | undefined> {
    const results = await executeInTransactionReturning<{ user_id: string; username: string }>([
      selectQuery("user_id", "username")
        .from(TABLES.refresh_tokens)
        .where("jti = $1 AND expires_at > now()", jti)
        .forUpdate()
        .build(),
      deleteQuery().from(TABLES.refresh_tokens).where("jti = $1", jti).build(),
    ]);
    const [row] = results[0]?.rows ?? [];
    if (!row) return undefined;

    return { userId: row.user_id, username: row.username };
  }

  async findRefresh(jti: string): Promise<RefreshEntry | undefined> {
    const query = selectQuery("user_id", "username")
      .from(TABLES.refresh_tokens)
      .where("jti = $1", jti)
      .where("expires_at > now()")
      .build();

    const { rows } = await execute<RefreshRow>(query.sql, query.values);
    const [row] = rows;
    if (!row) return undefined;

    return { userId: row.user_id, username: row.username };
  }

  async deleteRefresh(jti: string): Promise<void> {
    const query = deleteQuery().from(TABLES.refresh_tokens).where("jti = $1", jti).build();

    await execute(query.sql, query.values);
  }

  async deleteRefreshByUserId(userId: string): Promise<void> {
    const query = deleteQuery().from(TABLES.refresh_tokens).where("user_id = $1", userId).build();

    await execute(query.sql, query.values);
  }
}
