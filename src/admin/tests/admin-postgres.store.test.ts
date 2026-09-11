import { afterAll, beforeAll, expect, it } from "bun:test";
import type { AdminUser } from "../admin.store";
import { AdminPostgresStore } from "../admin_postgres.store";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  postgresDescribe,
} from "../../utils/tests/postgres-suite";
import { execute, insertQuery, selectQuery, TABLES } from "../../utils/sql";

const store = new AdminPostgresStore();
const prefix = "pgadm";

const createAdminUser = async (overrides: Partial<AdminUser> = {}): Promise<AdminUser> => {
  const seeded = await createPostgresUser({
    usernamePrefix: prefix,
    role: overrides.role,
    approved: overrides.approved,
    banned: overrides.banned,
  });
  return {
    uuid: seeded.uuid,
    username: seeded.username,
    role: seeded.role,
    approved: seeded.approved,
    banned: seeded.banned,
  };
};

const insertTextures = async (uuid: string): Promise<void> => {
  const query = insertQuery("uuid", "skin_url", "skin_model", "cape_url")
    .from(TABLES.user_textures)
    .values(
      uuid,
      "http://localhost:3005/textures/test-skin.png",
      "slim",
      "http://localhost:3005/capes/test-cape.png",
    )
    .build();
  await execute(query.sql, query.values);
};

const findTextureRow = async (uuid: string): Promise<Record<string, unknown> | undefined> => {
  const query = selectQuery("skin_url", "skin_model", "cape_url")
    .from(TABLES.user_textures)
    .where("uuid = $1", uuid)
    .build();
  const { rows } = await execute(query.sql, query.values);
  return rows[0];
};

postgresDescribe("AdminPostgresStore (postgres)", () => {
  beforeAll(async () => {
    await ensurePostgresSchema();
  });

  afterAll(async () => {
    await cleanupTrackedUsers();
  });

  it("findByUsername находит и не находит пользователя", async () => {
    const user = await createAdminUser();

    const found = await store.findByUsername(user.username);
    expect(found).toEqual(user);
    expect(await store.findByUsername(`pgadm_missing_${user.uuid.slice(0, 8)}`)).toBeUndefined();
  });

  it("saveUser обновляет существующего пользователя", async () => {
    const user = await createAdminUser();

    await store.saveUser({ ...user, role: "admin", approved: true, banned: true });

    const found = await store.findByUsername(user.username);
    expect(found?.role).toBe("admin");
    expect(found?.approved).toBe(true);
    expect(found?.banned).toBe(true);
    expect(found?.uuid).toBe(user.uuid);
  });

  it("searchUsers фильтрует по префиксу username без учёта регистра", async () => {
    const first = await createAdminUser();
    const second = await createAdminUser();

    const page = await store.searchUsers({ limit: 100, offset: 0, username: "PGADM" });

    expect(page.items.map((item) => item.username)).toContain(first.username);
    expect(page.items.map((item) => item.username)).toContain(second.username);
    for (const item of page.items) {
      expect(item.username.startsWith(prefix)).toBe(true);
    }
  });

  it("searchUsers фильтрует по approved и пагинирует без пересечений", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createAdminUser({ approved: false });
    }

    const filter = { limit: 2, offset: 0, username: prefix, approved: false };
    const firstPage = await store.searchUsers(filter);
    const secondPage = await store.searchUsers({ ...filter, offset: 2 });

    expect(firstPage.items.length).toBeLessThanOrEqual(2);
    expect(firstPage.total).toBeGreaterThanOrEqual(3);
    for (const item of firstPage.items) {
      expect(item.approved).toBe(false);
    }
    const firstPageUuids = new Set(firstPage.items.map((item) => item.uuid));
    for (const item of secondPage.items) {
      expect(firstPageUuids.has(item.uuid)).toBe(false);
    }
  });

  it("setApproved, setBanned и setRole меняют состояние пользователя", async () => {
    const user = await createAdminUser();

    await store.setApproved(user.username, true);
    await store.setBanned(user.username, true);
    await store.setRole(user.username, "admin");

    const found = await store.findByUsername(user.username);
    expect(found?.approved).toBe(true);
    expect(found?.banned).toBe(true);
    expect(found?.role).toBe("admin");
  });

  it("deleteUser переносит пользователя с текстурами в deleted_users", async () => {
    const user = await createAdminUser();
    await insertTextures(user.uuid);

    const removed = await store.deleteUser(user.username);

    expect(removed).toEqual(user);
    expect(await store.findByUsername(user.username)).toBeUndefined();
    const deleted = await store.findDeletedByUsername(user.username);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBeInstanceOf(Date);

    const textureRow = await execute<{ skin_url: string | null }>(
      `SELECT skin_url FROM ${TABLES.deleted_users} WHERE username = $1`,
      [user.username],
    );
    expect(textureRow.rows[0]?.skin_url).toBe("http://localhost:3005/textures/test-skin.png");
    expect(await findTextureRow(user.uuid)).toBeUndefined();

    await store.restoreUser(user.username);

    const restored = await store.findByUsername(user.username);
    expect(restored).toBeDefined();
    const textures = await findTextureRow(user.uuid);
    expect(textures?.["skin_url"]).toBe("http://localhost:3005/textures/test-skin.png");
    expect(textures?.["cape_url"]).toBe("http://localhost:3005/capes/test-cape.png");
    expect(await store.findDeletedByUsername(user.username)).toBeUndefined();
  });

  it("deleteUser и restoreUser работают без текстур", async () => {
    const user = await createAdminUser();

    await store.deleteUser(user.username);
    expect(await store.findDeletedByUsername(user.username)).toBeDefined();

    await store.restoreUser(user.username);

    expect(await store.findByUsername(user.username)).toBeDefined();
    expect(await findTextureRow(user.uuid)).toBeUndefined();
    expect(await store.findDeletedByUsername(user.username)).toBeUndefined();
  });

  it("deleteUser неизвестного пользователя возвращает undefined", async () => {
    expect(await store.deleteUser(`pgadm_missing_${Date.now()}`)).toBeUndefined();
  });

  it("searchDeletedUsers ищет по префиксу username", async () => {
    const first = await createAdminUser();
    const second = await createAdminUser();
    await store.deleteUser(first.username);
    await store.deleteUser(second.username);

    const page = await store.searchDeletedUsers({ limit: 100, offset: 0, username: prefix });

    const usernames = page.items.map((item) => item.username);
    expect(usernames).toContain(first.username);
    expect(usernames).toContain(second.username);
    for (const item of page.items) {
      expect(item.username.startsWith(prefix)).toBe(true);
      expect(item.deletedAt).toBeInstanceOf(Date);
    }
  });

  it("hasOwner видит овнера", async () => {
    await createAdminUser({ role: "owner" });

    expect(await store.hasOwner()).toBe(true);
  });
});
