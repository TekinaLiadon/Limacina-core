import { Injectable } from "@nestjs/common";
import type {
  ContentType,
  IUserContentStore,
  UserContentItem,
} from "../user-content/user-content.store";
import type { MemoryDb } from "./memory-db";

@Injectable()
export class UserContentMapStore implements IUserContentStore {
  constructor(private readonly db: MemoryDb) {}

  private getStore(type: ContentType): Map<number, UserContentItem> {
    return type === "skin" ? this.db.userSkins : this.db.userModels;
  }

  private getNextId(type: ContentType): number {
    if (type === "skin") return this.db.nextUserSkinId++;
    return this.db.nextUserModelId++;
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
