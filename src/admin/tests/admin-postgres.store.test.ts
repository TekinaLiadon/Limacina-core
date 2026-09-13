import { afterAll, beforeAll, expect, it } from "bun:test";
import type { AdminUser } from "../admin.store";
import { AdminPostgresStore } from "../admin_postgres.store";
import { AuthPostgresStore } from "../../auth/service/auth_postgres.service";
import type { StoredUser } from "../../auth/service/auth_store.service";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  postgresDescribe,
  trackPostgresUser,
} from "../../utils/tests/postgres-suite";
import { execute, insertQuery, selectQuery, updateQuery, TABLES } from "../../utils/sql";
import { generateUuid } from "../../utils/uuid";

const store = new AdminPostgresStore();
const authStore = new AuthPostgresStore();
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

const findRawUser = async (uuid: string): Promise<Record<string, unknown> | undefined> => {
  const query = selectQuery("deleted", "deleted_at")
    .from(TABLES.users)
    .where("uuid = $1", uuid)
    .build();
  const { rows } = await execute(query.sql, query.values);
  return rows[0];
};

const findPasswordChangedAt = async (uuid: string): Promise<Date | null> => {
  const query = selectQuery("password_changed_at")
    .from(TABLES.users)
    .where("uuid = $1", uuid)
    .build();
  const { rows } = await execute<{ password_changed_at: Date | null }>(query.sql, query.values);
  return rows[0]?.password_changed_at ?? null;
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

  it("searchUsers сортирует по lower(username) независимо от регистра", async () => {
    const suffix = generateUuid().slice(0, 8);
    const orderPrefix = `${prefix}_ord`;
    const names = [
      `${orderPrefix}_AAA${suffix}`,
      `${orderPrefix}_bbb${suffix}`,
      `${orderPrefix}_ZZZ${suffix}`,
    ];
    for (const username of names) {
      const uuid = generateUuid();
      const saved = await authStore.saveUser({
        uuid,
        username,
        passwordHash: "order-test-hash",
        role: "user",
        approved: true,
        banned: false,
      });
      trackPostgresUser({ uuid });
      expect(saved).toBe(true);
    }

    const page = await store.searchUsers({ limit: 100, offset: 0, username: orderPrefix });

    const ordered = page.items
      .map((item) => item.username)
      .filter((username) => names.includes(username));
    expect(ordered).toEqual(names);
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

  it("deleteUser помечает пользователя deleted и ставит deleted_at", async () => {
    const user = await createAdminUser();
    await insertTextures(user.uuid);

    const removed = await store.deleteUser(user.username);

    expect(removed).toEqual(user);
    expect(await store.findByUsername(user.username)).toBeUndefined();
    expect(await store.findDeletedByUsername(user.username)).toBeDefined();

    const row = await findRawUser(user.uuid);
    expect(row?.["deleted"]).toBe(true);
    expect(row?.["deleted_at"]).toBeInstanceOf(Date);

    const textures = await findTextureRow(user.uuid);
    expect(textures?.["skin_url"]).toBe("http://localhost:3005/textures/test-skin.png");
  });

  it("restoreUser снимает пометку deleted и очищает deleted_at", async () => {
    const user = await createAdminUser();
    await insertTextures(user.uuid);

    await store.deleteUser(user.username);
    await store.restoreUser(user.username);

    const restored = await store.findByUsername(user.username);
    expect(restored).toBeDefined();
    expect(await store.findDeletedByUsername(user.username)).toBeUndefined();

    const row = await findRawUser(user.uuid);
    expect(row?.["deleted"]).toBe(false);
    expect(row?.["deleted_at"]).toBeNull();
    const textures = await findTextureRow(user.uuid);
    expect(textures?.["skin_url"]).toBe("http://localhost:3005/textures/test-skin.png");
    expect(textures?.["cape_url"]).toBe("http://localhost:3005/capes/test-cape.png");
  });

  it("password_hash и password_changed_at сохраняются при delete → restore", async () => {
    const user = await createAdminUser();
    const changedAt = new Date("2026-09-01T12:00:00Z");
    const backdated = updateQuery()
      .from(TABLES.users)
      .set("password_changed_at", changedAt)
      .where("uuid = $1", user.uuid)
      .build();
    await execute(backdated.sql, backdated.values);

    await store.deleteUser(user.username);
    await store.restoreUser(user.username);

    const found = await store.findByUsername(user.username);
    expect(found?.role).toBe(user.role);
    expect(await findPasswordChangedAt(user.uuid)).toEqual(changedAt);
  });

  it("searchUsers не отдаёт удалённых, searchDeletedUsers только удалённых", async () => {
    const live = await createAdminUser();
    const removed = await createAdminUser();
    await store.deleteUser(removed.username);

    const livePage = await store.searchUsers({ limit: 100, offset: 0, username: prefix });
    expect(livePage.items.map((item) => item.username)).toContain(live.username);
    expect(livePage.items.map((item) => item.username)).not.toContain(removed.username);

    const deletedPage = await store.searchDeletedUsers({ limit: 100, offset: 0, username: prefix });
    expect(deletedPage.items.map((item) => item.username)).toContain(removed.username);
    expect(deletedPage.items.map((item) => item.username)).not.toContain(live.username);
    for (const item of deletedPage.items) {
      expect(item.deletedAt).toBeInstanceOf(Date);
    }
  });

  it("никнейм удалённого можно занять заново, restore тогда отклоняется", async () => {
    const user = await createAdminUser({ approved: true });
    await store.deleteUser(user.username);

    const reissued: StoredUser = {
      uuid: generateUuid(),
      username: user.username,
      passwordHash: await Bun.password.hash("limacina-reissued"),
      role: "user",
      approved: true,
      banned: false,
    };
    trackPostgresUser(reissued);
    expect(await authStore.userExists(user.username)).toBe(false);
    expect(await authStore.saveUser(reissued)).toBe(true);

    await expect(store.restoreUser(user.username)).rejects.toThrow();
  });

  it("purgeOldDeletedUsers удаляет только просроченных удалённых", async () => {
    const stale = await createAdminUser();
    const fresh = await createAdminUser();
    await store.deleteUser(stale.username);
    await store.deleteUser(fresh.username);

    const backdate = updateQuery()
      .from(TABLES.users)
      .set("deleted_at", new Date(Date.now() - 31 * 24 * 60 * 60 * 1000))
      .where("uuid = $1", stale.uuid)
      .build();
    await execute(backdate.sql, backdate.values);

    const purged = await store.purgeOldDeletedUsers(30);

    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await findRawUser(stale.uuid)).toBeUndefined();
    expect(await findRawUser(fresh.uuid)).toBeDefined();
    expect(await store.findByUsername(fresh.username)).toBeUndefined();
    expect(await store.findDeletedByUsername(fresh.username)).toBeDefined();
  });

  it("hasOwner не считает удалённого овнера", async () => {
    const owner = await createAdminUser({ role: "owner" });

    expect(await store.hasOwner()).toBe(true);

    await store.deleteUser(owner.username);

    const { rows: otherLiveOwners } = await execute(
      "SELECT 1 FROM users WHERE role = 'owner' AND deleted = false AND uuid <> $1 LIMIT 1",
      [owner.uuid],
    );
    expect(await store.hasOwner()).toBe(otherLiveOwners.length > 0);

    await store.restoreUser(owner.username);
    expect(await store.hasOwner()).toBe(true);
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
