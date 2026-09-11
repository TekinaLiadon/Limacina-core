import { Injectable } from "@nestjs/common";
import {
  selectQuery,
  insertQuery,
  updateQuery,
  deleteQuery,
  execute,
  executeInTransaction,
  TABLES,
} from "../utils/sql";

export type ContentType = "skin" | "cape" | "model";

export interface UserContentItem {
  id: number;
  userUuid: string;
  filePath: string;
  skinModel?: string | null;
  active: boolean;
}

export const UserContentMapStoreToken = Symbol("UserContentMapStore");

export interface IUserContentStore {
  countByUserUuid(userUuid: string, type: ContentType): Promise<number>;
  findByUserUuid(userUuid: string, type: ContentType): Promise<UserContentItem[]>;
  findById(id: number, type: ContentType): Promise<UserContentItem | undefined>;
  save(
    userUuid: string,
    filePath: string,
    type: ContentType,
    skinModel?: string | null,
  ): Promise<UserContentItem>;
  deleteById(id: number, type: ContentType): Promise<UserContentItem | undefined>;
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
    active: row.active ?? false,
  };
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

  async deleteById(id: number, type: ContentType): Promise<UserContentItem | undefined> {
    const table = getTable(type);
    const findQ = selectQuery("id", "user_uuid", "file_path")
      .from(table)
      .where("id = $1", id)
      .build();
    const { rows: found } = await execute<ContentRow>(findQ.sql, findQ.values);
    const [item] = found;
    if (!item) return undefined;

    const delQ = deleteQuery().from(table).where("id = $1", id).build();
    await execute(delQ.sql, delQ.values);
    return rowToItem(item);
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

  async deleteById(id: number, type: ContentType): Promise<UserContentItem | undefined> {
    const store = this.getStore(type);
    const item = store.get(id);
    if (!item) return undefined;
    store.delete(id);
    return item;
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
