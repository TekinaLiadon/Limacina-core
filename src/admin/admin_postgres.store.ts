import { Injectable } from "@nestjs/common";
import { selectQuery, updateQuery, execute, TABLES } from "../utils/sql";
import type { IAdminStore, AdminUser } from "./admin.store";
import type { UserRow } from "./dto/dto";

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
}
