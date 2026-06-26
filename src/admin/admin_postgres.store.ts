import { Injectable } from "@nestjs/common";
import { selectQuery, updateQuery, execute, TABLES } from "../utils/sql";
import type { IAdminStore } from "./admin.store";
import type { StoredUser } from "../auth/service/auth_store.service";
import type { UserRow } from "./dto/dto";

@Injectable()
export class AdminPostgresStore implements IAdminStore {
  async findByUsername(username: string): Promise<StoredUser | undefined> {
    const query = selectQuery(
      "u.uuid",
      "u.username",
      "u.password_hash",
      "t.skin_url",
      "u.role",
      "u.approved",
    )
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
      role: row.role,
      approved: row.approved,
    };
  }

  async findUnapprovedUsers(limit: number): Promise<StoredUser[]> {
    const query = selectQuery("uuid", "username", "password_hash", "role", "approved")
      .from(TABLES.users)
      .where("approved = $1", false)
      .limit(limit)
      .build();

    const { rows } = await execute<UserRow>(query.sql, query.values);
    return rows.map((row) => ({
      uuid: row.uuid,
      username: row.username,
      passwordHash: row.password_hash,
      skin: null,
      role: row.role,
      approved: row.approved,
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
}
