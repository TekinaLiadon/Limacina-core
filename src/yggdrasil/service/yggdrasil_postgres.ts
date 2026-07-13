import { Injectable } from "@nestjs/common";
import { insertQuery, selectQuery, execute, TABLES } from "../../utils/sql";
import type { IYggdrasilStore, YggdrasilProfile } from "./yggdrasil_store";

interface ProfileRow extends Record<string, unknown> {
  uuid: string;
  user_id: string;
  username: string;
  skin_url: string | null;
  skin_model: string | null;
  cape_url: string | null;
}

interface UserRow extends Record<string, unknown> {
  uuid: string;
  password_hash: string;
}

function rowToProfile(row: ProfileRow): YggdrasilProfile {
  return {
    uuid: row.uuid,
    userId: row.user_id,
    username: row.username,
    skinUrl: row.skin_url,
    skinModel: row.skin_model,
    capeUrl: row.cape_url,
  };
}

const PROFILE_COLUMNS = [
  "u.uuid",
  "u.uuid AS user_id",
  "u.username",
  "t.skin_url",
  "t.skin_model",
  "t.cape_url",
] as const;

function profileBase() {
  return selectQuery(...PROFILE_COLUMNS)
    .from(TABLES.users, "u")
    .join("LEFT JOIN", TABLES.user_textures, "t", "t.uuid = u.uuid");
}

@Injectable()
export class YggdrasilPostgresStore implements IYggdrasilStore {
  async findProfileByUuid(uuid: string): Promise<YggdrasilProfile | undefined> {
    const q = profileBase().where("u.uuid = $1", uuid).build();
    const { rows } = await execute<ProfileRow>(q.sql, q.values);
    const row = rows[0];
    if (!row) return undefined;
    return rowToProfile(row);
  }

  async findProfileByUsername(username: string): Promise<YggdrasilProfile | undefined> {
    const q = profileBase().where("u.username = $1", username).build();
    const { rows } = await execute<ProfileRow>(q.sql, q.values);
    const row = rows[0];
    if (!row) return undefined;
    return rowToProfile(row);
  }

  async findProfilesByUserId(userId: string): Promise<YggdrasilProfile[]> {
    const q = profileBase().where("u.uuid = $1", userId).build();
    const { rows } = await execute<ProfileRow>(q.sql, q.values);
    return rows.map(rowToProfile);
  }

  async findProfilesByUsernames(usernames: string[]): Promise<YggdrasilProfile[]> {
    if (usernames.length === 0) return [];

    const placeholders = usernames.map((_, i) => `$${i + 1}`).join(", ");
    const q = profileBase()
      .where(`u.username IN (${placeholders})`, ...usernames)
      .build();
    const { rows } = await execute<ProfileRow>(q.sql, q.values);
    return rows.map(rowToProfile);
  }

  async saveProfile(profile: YggdrasilProfile): Promise<void> {
    const q = insertQuery("uuid", "skin_url", "skin_model", "cape_url")
      .from(TABLES.user_textures)
      .values(
        profile.uuid,
        profile.skinUrl ?? null,
        profile.skinModel ?? null,
        profile.capeUrl ?? null,
      )
      .build();

    await execute(q.sql, q.values);
  }

  async updateProfileTexture(
    uuid: string,
    textures: { skinUrl?: string | null; skinModel?: string | null; capeUrl?: string | null },
  ): Promise<void> {
    const sets: [string, string | null][] = [];
    if (textures.skinUrl !== undefined) sets.push(["skin_url", textures.skinUrl]);
    if (textures.skinModel !== undefined) sets.push(["skin_model", textures.skinModel]);
    if (textures.capeUrl !== undefined) sets.push(["cape_url", textures.capeUrl]);
    if (sets.length === 0) return;

    const columns = ["uuid", ...sets.map((s) => s[0])];
    const values = [uuid, ...sets.map((s) => s[1])];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const setClauses = sets.map((s, i) => `${s[0]} = $${i + 2}`).join(", ");

    const sql = `INSERT INTO ${TABLES.user_textures} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (uuid) DO UPDATE SET ${setClauses}`;
    await execute(sql, values);
  }

  async findUserByUsername(
    username: string,
  ): Promise<{ uuid: string; passwordHash: string } | undefined> {
    const q = selectQuery("uuid", "password_hash")
      .from(TABLES.users)
      .where("username = $1", username)
      .build();
    const { rows } = await execute<UserRow>(q.sql, q.values);
    const row = rows[0];
    if (!row) return undefined;

    return { uuid: row.uuid, passwordHash: row.password_hash };
  }
}
