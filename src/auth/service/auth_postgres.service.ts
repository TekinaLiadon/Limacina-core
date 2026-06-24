import { Injectable } from "@nestjs/common";
import {
  insertQuery,
  selectQuery,
  updateQuery,
  deleteQuery,
  execute,
  TABLES,
} from "../../utils/sql";
import type { IAuthStore, StoredUser, RefreshEntry } from "./auth_store.service";

interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  password_hash: string;
  skin_url: string | null;
}

interface RefreshRow extends Record<string, unknown> {
  jti: string;
  user_id: string;
  username: string;
}

@Injectable()
export class AuthPostgresStore implements IAuthStore {
  async findByUsername(username: string): Promise<StoredUser | undefined> {
    const query = selectQuery("u.uuid", "u.username", "u.password_hash", "t.skin_url")
      .from(TABLES.users, "u")
      .join("LEFT JOIN", TABLES.user_textures, "t", "u.uuid = t.uuid")
      .where("u.username = $1", username)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    const row = rows[0];
    if (!row) return undefined;

    return {
      uuid: row.uuid,
      username: row.username,
      passwordHash: row.password_hash,
      skin: row.skin_url,
    };
  }

  async saveUser(user: StoredUser): Promise<void> {
    const query = insertQuery("uuid", "username", "password_hash")
      .from(TABLES.users)
      .values(user.uuid, user.username, user.passwordHash)
      .build();

    await execute(query.sql, query.values);
  }

  async userExists(username: string): Promise<boolean> {
    const query = selectQuery("1").from(TABLES.users).where("username = $1", username).build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.length > 0;
  }

  async updateSkin(uuid: string, skin: string): Promise<void> {
    const existing = await this.findSkinByUuid(uuid);

    if (existing) {
      const query = updateQuery()
        .from(TABLES.user_textures)
        .set("skin_url", skin)
        .where("uuid = $1", uuid)
        .build();
      await execute(query.sql, query.values);
    } else {
      const query = insertQuery("uuid", "skin_url")
        .from(TABLES.user_textures)
        .values(uuid, skin)
        .build();
      await execute(query.sql, query.values);
    }
  }

  private async findSkinByUuid(uuid: string): Promise<boolean> {
    const query = selectQuery("1").from(TABLES.user_textures).where("uuid = $1", uuid).build();
    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.length > 0;
  }

  async saveRefresh(jti: string, entry: RefreshEntry): Promise<void> {
    const query = insertQuery("jti", "user_id", "username")
      .from(TABLES.refresh_tokens)
      .values(jti, entry.userId, entry.username)
      .build();

    await execute(query.sql, query.values);
  }

  async findRefresh(jti: string): Promise<RefreshEntry | undefined> {
    const query = selectQuery("user_id", "username")
      .from(TABLES.refresh_tokens)
      .where("jti = $1", jti)
      .build();

    const { rows } = await execute<RefreshRow>(query.sql, query.values);
    const row = rows[0];
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
