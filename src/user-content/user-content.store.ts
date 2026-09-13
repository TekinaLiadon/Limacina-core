import { Injectable } from "@nestjs/common";
import {
  selectQuery,
  insertQuery,
  updateQuery,
  execute,
  executeInTransaction,
  executeInTransactionReturning,
  sqlDialect,
  toBoolean,
  TABLES,
  type BuiltQuery,
  type SqlValue,
} from "../utils/sql";

export type ContentType = "skin" | "cape" | "model";

export interface UserContentItem {
  id: number;
  userUuid: string;
  filePath: string;
  skinModel?: string | null;
  active: boolean;
}

export interface ContentDeletionResult {
  item: UserContentItem;
  remainingCount: number;
}

export interface UserContentLimitExceededError extends Error {
  readonly userContentLimitExceeded: true;
}

export const isUserContentLimitExceededError = (
  error: unknown,
): error is UserContentLimitExceededError =>
  error instanceof Error &&
  (error as UserContentLimitExceededError).userContentLimitExceeded === true;

export const UserContentMapStoreToken = Symbol("UserContentMapStore");

export interface IUserContentStore {
  countByUserUuid(userUuid: string, type: ContentType): Promise<number>;
  countByFilePath(filePath: string, type: ContentType): Promise<number>;
  findByUserUuid(userUuid: string, type: ContentType): Promise<UserContentItem[]>;
  findById(id: number, type: ContentType): Promise<UserContentItem | undefined>;
  save(
    userUuid: string,
    filePath: string,
    type: ContentType,
    skinModel?: string | null,
  ): Promise<UserContentItem>;
  saveWithinLimit(
    userUuid: string,
    filePath: string,
    type: ContentType,
    maxPerUser: number,
    skinModel?: string | null,
  ): Promise<UserContentItem>;
  deleteByIdAndCountRemaining(
    id: number,
    type: ContentType,
  ): Promise<ContentDeletionResult | undefined>;
  updateActiveSkin(userUuid: string, skinId: number): Promise<void>;
}

function getTable(type: ContentType): "user_skins" | "user_capes" | "user_models" {
  if (type === "skin") return TABLES.user_skins;
  if (type === "cape") return TABLES.user_capes;
  return TABLES.user_models;
}

interface ContentRow extends Record<string, unknown> {
  id: number;
  user_uuid: string;
  file_path: string;
  skin_model?: string | null;
  active?: boolean;
}

function rowToItem(row: ContentRow): UserContentItem {
  return {
    id: row.id,
    userUuid: row.user_uuid,
    filePath: row.file_path,
    skinModel: row.skin_model ?? null,
    active: toBoolean(row.active),
  };
}

function createUserContentLimitExceededError(
  userUuid: string,
  type: ContentType,
  maxPerUser: number,
): UserContentLimitExceededError {
  const name = type === "skin" ? "skins" : type === "cape" ? "capes" : "models";
  const error = new Error(
    `UserContentLimitExceeded: ${userUuid} ${name} limit ${maxPerUser} reached`,
  );
  return Object.assign(error, { userContentLimitExceeded: true as const });
}

@Injectable()
export class UserContentPostgresStore implements IUserContentStore {
  async countByUserUuid(userUuid: string, type: ContentType): Promise<number> {
    const table = getTable(type);
    const q = selectQuery("COUNT(*) AS count")
      .from(table)
      .where("user_uuid = $1", userUuid)
      .build();
    const { rows } = await execute<{ count: number }>(q.sql, q.values);
    return Number(rows[0]?.count ?? 0);
  }

  async countByFilePath(filePath: string, type: ContentType): Promise<number> {
    const table = getTable(type);
    const q = selectQuery("COUNT(*) AS count")
      .from(table)
      .where("file_path = $1", filePath)
      .build();
    const { rows } = await execute<{ count: number }>(q.sql, q.values);
    return Number(rows[0]?.count ?? 0);
  }

  async findByUserUuid(userUuid: string, type: ContentType): Promise<UserContentItem[]> {
    const table = getTable(type);
    const columns =
      type === "skin"
        ? ["id", "user_uuid", "file_path", "skin_model", "active"]
        : ["id", "user_uuid", "file_path"];
    const q = selectQuery(...columns)
      .from(table)
      .where("user_uuid = $1", userUuid)
      .build();
    const { rows } = await execute<ContentRow>(q.sql, q.values);
    return rows.map(rowToItem);
  }

  async findById(id: number, type: ContentType): Promise<UserContentItem | undefined> {
    const table = getTable(type);
    const columns =
      type === "skin"
        ? ["id", "user_uuid", "file_path", "skin_model", "active"]
        : ["id", "user_uuid", "file_path"];
    const q = selectQuery(...columns)
      .from(table)
      .where("id = $1", id)
      .build();
    const { rows } = await execute<ContentRow>(q.sql, q.values);
    return rows[0] ? rowToItem(rows[0]) : undefined;
  }

  async save(
    userUuid: string,
    filePath: string,
    type: ContentType,
    skinModel?: string | null,
  ): Promise<UserContentItem> {
    const table = getTable(type);
    const q =
      type === "skin"
        ? insertQuery("user_uuid", "file_path", "skin_model", "active")
            .from(table)
            .values(userUuid, filePath, skinModel ?? null, false)
            .returning("id", "user_uuid", "file_path", "skin_model", "active")
            .build()
        : insertQuery("user_uuid", "file_path")
            .from(table)
            .values(userUuid, filePath)
            .returning("id", "user_uuid", "file_path")
            .build();
    const { rows } = await execute<ContentRow>(q.sql, q.values);
    return rowToItem(rows[0]!);
  }

  async saveWithinLimit(
    userUuid: string,
    filePath: string,
    type: ContentType,
    maxPerUser: number,
    skinModel?: string | null,
  ): Promise<UserContentItem> {
    const table = getTable(type);
    const selectColumns =
      type === "skin"
        ? ["id", "user_uuid", "file_path", "skin_model", "active"]
        : ["id", "user_uuid", "file_path"];
    const returningColumns = selectColumns.join(", ");

    const lock = selectQuery("uuid")
      .from(TABLES.users)
      .where("uuid = $1", userUuid)
      .forUpdate()
      .build();

    const insertColumns =
      type === "skin" ? "user_uuid, file_path, skin_model, active" : "user_uuid, file_path";
    const insertValues =
      type === "skin" ? [userUuid, filePath, skinModel ?? null, false] : [userUuid, filePath];
    const insertPlaceholders = insertValues.map((_, i) => `$${i + 2}`).join(", ");
    const insertSql =
      `INSERT INTO ${table} (${insertColumns}) ` +
      `SELECT ${insertPlaceholders} ` +
      `WHERE (SELECT COUNT(*) FROM ${table} WHERE user_uuid = $1) < $${insertValues.length + 2}`;

    const statements: BuiltQuery[] =
      sqlDialect() === "mariadb"
        ? [
            lock,
            { sql: insertSql, values: [userUuid, ...insertValues, maxPerUser] as SqlValue[] },
            selectQuery(...selectColumns)
              .from(table)
              .where("user_uuid = $1 AND file_path = $2", userUuid, filePath)
              .orderBy("id", "desc")
              .limit(1)
              .build(),
          ]
        : [
            lock,
            {
              sql: `${insertSql} RETURNING ${returningColumns}`,
              values: [userUuid, ...insertValues, maxPerUser] as SqlValue[],
            },
          ];

    const transactionResults = await executeInTransactionReturning<ContentRow>(statements);
    const mariadb = sqlDialect() === "mariadb";
    const insertSucceeded = mariadb
      ? (transactionResults[1]?.count ?? 0) > 0
      : (transactionResults[1]?.rows ?? []).length > 0;
    const results = mariadb
      ? (transactionResults[2]?.rows ?? [])
      : (transactionResults[1]?.rows ?? []);
    const [row] = results;
    if (!insertSucceeded || !row) {
      throw createUserContentLimitExceededError(userUuid, type, maxPerUser);
    }
    return rowToItem(row);
  }

  async updateActiveSkin(userUuid: string, skinId: number): Promise<void> {
    const deactivate = updateQuery()
      .from(TABLES.user_skins)
      .set("active", false)
      .where("user_uuid = $1", userUuid)
      .build();

    const activate = updateQuery()
      .from(TABLES.user_skins)
      .set("active", true)
      .where("id = $1", skinId)
      .build();

    await executeInTransaction([deactivate, activate]);
  }

  async deleteByIdAndCountRemaining(
    id: number,
    type: ContentType,
  ): Promise<ContentDeletionResult | undefined> {
    const table = getTable(type);
    const selectColumns =
      type === "skin"
        ? ["id", "user_uuid", "file_path", "skin_model", "active"]
        : ["id", "user_uuid", "file_path"];
    const existingQuery = selectQuery(...selectColumns)
      .from(table)
      .where("id = $1", id)
      .build();
    const existing = await execute<ContentRow>(existingQuery.sql, existingQuery.values);
    const [item] = existing.rows;
    if (!item) return undefined;

    const results = await executeInTransactionReturning<
      ContentRow & { same_path_total: number | string }
    >([
      {
        sql: `SELECT COUNT(*) AS same_path_total FROM ${table} WHERE file_path = $1`,
        values: [item.file_path],
      },
      {
        sql: `DELETE FROM ${table} WHERE id = $1 RETURNING id`,
        values: [id],
      },
    ]);
    if ((results[1]?.count ?? 0) === 0) return undefined;

    const samePathTotal = Number(results[0]?.rows[0]?.same_path_total ?? 0);
    return { item: rowToItem(item), remainingCount: samePathTotal - 1 };
  }
}

@Injectable()
export class UserContentMapStore implements IUserContentStore {
  private readonly skins = new Map<number, UserContentItem>();
  private readonly capes = new Map<number, UserContentItem>();
  private readonly models = new Map<number, UserContentItem>();
  private nextSkinId = 1;
  private nextCapeId = 1;
  private nextModelId = 1;

  private getStore(type: ContentType): Map<number, UserContentItem> {
    if (type === "skin") return this.skins;
    if (type === "cape") return this.capes;
    return this.models;
  }

  private getNextId(type: ContentType): number {
    if (type === "skin") return this.nextSkinId++;
    if (type === "cape") return this.nextCapeId++;
    return this.nextModelId++;
  }

  async countByUserUuid(userUuid: string, type: ContentType): Promise<number> {
    let count = 0;
    for (const item of this.getStore(type).values()) {
      if (item.userUuid === userUuid) count++;
    }
    return count;
  }

  async countByFilePath(filePath: string, type: ContentType): Promise<number> {
    let count = 0;
    for (const item of this.getStore(type).values()) {
      if (item.filePath === filePath) count++;
    }
    return count;
  }

  async findByUserUuid(userUuid: string, type: ContentType): Promise<UserContentItem[]> {
    const result: UserContentItem[] = [];
    for (const item of this.getStore(type).values()) {
      if (item.userUuid === userUuid) result.push(item);
    }
    return result;
  }

  async findById(id: number, type: ContentType): Promise<UserContentItem | undefined> {
    return this.getStore(type).get(id);
  }

  async save(
    userUuid: string,
    filePath: string,
    type: ContentType,
    skinModel?: string | null,
  ): Promise<UserContentItem> {
    const id = this.getNextId(type);
    const item: UserContentItem = {
      id,
      userUuid,
      filePath,
      skinModel: skinModel ?? null,
      active: type !== "skin",
    };
    this.getStore(type).set(id, item);
    return item;
  }

  async saveWithinLimit(
    userUuid: string,
    filePath: string,
    type: ContentType,
    maxPerUser: number,
    skinModel?: string | null,
  ): Promise<UserContentItem> {
    const store = this.getStore(type);
    let count = 0;
    for (const item of store.values()) {
      if (item.userUuid === userUuid) count++;
    }
    if (count >= maxPerUser) {
      throw createUserContentLimitExceededError(userUuid, type, maxPerUser);
    }
    return this.save(userUuid, filePath, type, skinModel);
  }

  async deleteByIdAndCountRemaining(
    id: number,
    type: ContentType,
  ): Promise<ContentDeletionResult | undefined> {
    const store = this.getStore(type);
    const item = store.get(id);
    if (!item) return undefined;
    store.delete(id);

    let remainingCount = 0;
    for (const other of store.values()) {
      if (other.filePath === item.filePath) remainingCount++;
    }

    return { item, remainingCount };
  }

  async updateActiveSkin(userUuid: string, skinId: number): Promise<void> {
    const { skins } = this;
    for (const item of skins.values()) {
      if (item.userUuid !== userUuid) continue;
      const updated: UserContentItem = { ...item, active: item.id === skinId };
      skins.set(item.id, updated);
    }
  }
}
