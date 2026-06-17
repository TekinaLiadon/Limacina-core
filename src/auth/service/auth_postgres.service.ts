import { Injectable } from "@nestjs/common";
import { insertQuery, selectQuery, deleteQuery, execute } from "../../utils/sql";
import type { IAuthStore, StoredUser, RefreshEntry } from "./auth_store.service";

interface UserRow extends Record<string, unknown> {
  uuid: string;
  username: string;
  password_hash: string;
}

interface RefreshRow extends Record<string, unknown> {
  jti: string;
  user_id: string;
  username: string;
}

@Injectable()
export class AuthPostgresStore implements IAuthStore {
  async findByUsername(username: string): Promise<StoredUser | undefined> {
    const query = selectQuery("uuid", "username", "password_hash")
      .from("users")
      .where("username = $1", username)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    const row = rows[0];
    if (!row) return undefined;

    return {
      uuid: row.uuid,
      username: row.username,
      passwordHash: row.password_hash,
    };
  }

  async saveUser(user: StoredUser): Promise<void> {
    const query = insertQuery("users", "uuid", "username", "password_hash")
      .values(user.uuid, user.username, user.passwordHash)
      .build();

    await execute(query.sql, query.values);
  }

  async userExists(username: string): Promise<boolean> {
    const query = selectQuery("1").from("users").where("username = $1", username).build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.length > 0;
  }

  async saveRefresh(jti: string, entry: RefreshEntry): Promise<void> {
    const query = insertQuery("refresh_tokens", "jti", "user_id", "username")
      .values(jti, entry.userId, entry.username)
      .build();

    await execute(query.sql, query.values);
  }

  async findRefresh(jti: string): Promise<RefreshEntry | undefined> {
    const query = selectQuery("user_id", "username")
      .from("refresh_tokens")
      .where("jti = $1", jti)
      .build();

    const { rows } = await execute<RefreshRow>(query.sql, query.values);
    const row = rows[0];
    if (!row) return undefined;

    return { userId: row.user_id, username: row.username };
  }

  async deleteRefresh(jti: string): Promise<void> {
    const query = deleteQuery("refresh_tokens").where("jti = $1", jti).build();

    await execute(query.sql, query.values);
  }

  async deleteRefreshByUserId(userId: string): Promise<void> {
    const query = deleteQuery("refresh_tokens").where("user_id = $1", userId).build();

    await execute(query.sql, query.values);
  }
}
