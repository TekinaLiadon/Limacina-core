import { Injectable } from "@nestjs/common";
import { selectQuery, insertQuery, deleteQuery, execute, TABLES } from "../utils/sql";

export type ContentType = "skin" | "model";

export interface UserContentItem {
  id: number;
  userUuid: string;
  filePath: string;
}

export const UserContentMapStoreToken = Symbol("UserContentMapStore");

export interface IUserContentStore {
  countByUserUuid(userUuid: string, type: ContentType): Promise<number>;
  findByUserUuid(userUuid: string, type: ContentType): Promise<UserContentItem[]>;
  findById(id: number, type: ContentType): Promise<UserContentItem | undefined>;
  save(userUuid: string, filePath: string, type: ContentType): Promise<UserContentItem>;
  deleteById(id: number, type: ContentType): Promise<UserContentItem | undefined>;
}

function getTable(type: ContentType): "user_skins" | "user_models" {
  return type === "skin" ? TABLES.user_skins : TABLES.user_models;
}

interface ContentRow extends Record<string, unknown> {
  id: number;
  user_uuid: string;
  file_path: string;
}

function rowToItem(row: ContentRow): UserContentItem {
  return { id: row.id, userUuid: row.user_uuid, filePath: row.file_path };
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
    const q = selectQuery("id", "user_uuid", "file_path")
      .from(table)
      .where("user_uuid = $1", userUuid)
      .build();
    const { rows } = await execute<ContentRow>(q.sql, q.values);
    return rows.map(rowToItem);
  }

  async findById(id: number, type: ContentType): Promise<UserContentItem | undefined> {
    const table = getTable(type);
    const q = selectQuery("id", "user_uuid", "file_path").from(table).where("id = $1", id).build();
    const { rows } = await execute<ContentRow>(q.sql, q.values);
    return rows[0] ? rowToItem(rows[0]) : undefined;
  }

  async save(userUuid: string, filePath: string, type: ContentType): Promise<UserContentItem> {
    const table = getTable(type);
    const q = insertQuery("user_uuid", "file_path")
      .from(table)
      .values(userUuid, filePath)
      .returning("id", "user_uuid", "file_path")
      .build();
    const { rows } = await execute<ContentRow>(q.sql, q.values);
    return rowToItem(rows[0]!);
  }

  async deleteById(id: number, type: ContentType): Promise<UserContentItem | undefined> {
    const table = getTable(type);
    const findQ = selectQuery("id", "user_uuid", "file_path")
      .from(table)
      .where("id = $1", id)
      .build();
    const { rows: found } = await execute<ContentRow>(findQ.sql, findQ.values);
    const item = found[0];
    if (!item) return undefined;

    const delQ = deleteQuery().from(table).where("id = $1", id).build();
    await execute(delQ.sql, delQ.values);
    return rowToItem(item);
  }
}

@Injectable()
export class UserContentMapStore implements IUserContentStore {
  private readonly skins = new Map<number, UserContentItem>();
  private readonly models = new Map<number, UserContentItem>();
  private nextSkinId = 1;
  private nextModelId = 1;

  private getStore(type: ContentType): Map<number, UserContentItem> {
    return type === "skin" ? this.skins : this.models;
  }

  private getNextId(type: ContentType): number {
    if (type === "skin") return this.nextSkinId++;
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

  async save(userUuid: string, filePath: string, type: ContentType): Promise<UserContentItem> {
    const id = this.getNextId(type);
    const item: UserContentItem = { id, userUuid, filePath };
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
}
