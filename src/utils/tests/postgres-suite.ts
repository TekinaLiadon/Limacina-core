import { describe } from "bun:test";
import { AuthPostgresStore } from "../../auth/service/auth_postgres.service";
import type { StoredUser } from "../../auth/service/auth_store.service";
import { deleteQuery, execute, TABLES } from "../sql";
import { generateUuid } from "../uuid";

const authStore = new AuthPostgresStore();

const trackedUuids = new Set<string>();
const trackedUsernames = new Set<string>();

export interface PostgresUserSeed {
  usernamePrefix?: string;
  role?: string | undefined;
  approved?: boolean | undefined;
  banned?: boolean | undefined;
}

export function postgresDescribe(name: string, fn: () => void): void {
  if (!process.env["DATABASE_URL"]) {
    describe.skip(name, fn);
    return;
  }
  describe(name, fn);
}

export async function ensurePostgresSchema(): Promise<void> {
  try {
    await execute("SELECT 1 FROM users LIMIT 1", []);
  } catch {
    throw new Error(
      "Postgres недоступен или схема не применена — проверьте DATABASE_URL и выполните bun run migrate:up",
    );
  }
}

export async function createPostgresUser(seed: PostgresUserSeed = {}): Promise<StoredUser> {
  const user: StoredUser = {
    uuid: generateUuid(),
    username: `${seed.usernamePrefix ?? "pgt"}_${generateUuid().slice(0, 12)}`,
    passwordHash: await Bun.password.hash("limacina-test-password"),
    role: seed.role ?? "user",
    approved: seed.approved ?? false,
    banned: seed.banned ?? false,
  };
  const created = await authStore.saveUser(user);
  if (!created) {
    throw new Error(`Не удалось создать тестового пользователя ${user.username}`);
  }
  trackPostgresUser(user);
  return user;
}

export function trackPostgresUser(user: { uuid: string; username: string }): void {
  trackedUuids.add(user.uuid);
  trackedUsernames.add(user.username);
}

export async function cleanupTrackedUsers(): Promise<void> {
  for (const username of trackedUsernames) {
    const deleted = deleteQuery()
      .from(TABLES.deleted_users)
      .where("username = $1", username)
      .build();
    await execute(deleted.sql, deleted.values);
  }
  for (const uuid of trackedUuids) {
    const query = deleteQuery().from(TABLES.users).where("uuid = $1", uuid).build();
    await execute(query.sql, query.values);
  }
  trackedUuids.clear();
  trackedUsernames.clear();
}
