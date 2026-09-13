import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { AdminMapStore } from "../admin.store";
import type { AdminUser, IAdminStore, UsersFilter } from "../admin.store";
import { AdminPostgresStore } from "../admin_postgres.store";
import { AuthPostgresStore } from "../../auth/service/auth_postgres.service";
import type { StoredUser } from "../../auth/service/auth_store.service";
import { generateUuid } from "../../utils/uuid";
import {
  cleanupTrackedUsers,
  ensurePostgresSchema,
  trackPostgresUser,
} from "../../utils/tests/postgres-suite";
import { contractDescribeEach } from "../../utils/tests/driver-contract";

interface AdminDriverContext {
  store: IAdminStore;
  makeUser: (overrides?: Partial<AdminUser> & { username?: string }) => Promise<AdminUser>;
}

const uniqueUsername = (stem: string): string => `${stem}_${generateUuid().slice(0, 8)}`;

const adminView = (user: StoredUser): AdminUser => ({
  uuid: user.uuid,
  username: user.username,
  role: user.role,
  approved: user.approved,
  banned: user.banned,
});

const mapContext = (): AdminDriverContext => {
  const store = new AdminMapStore();
  const makeUser = async (
    overrides: Partial<AdminUser> & { username?: string } = {},
  ): Promise<AdminUser> => {
    const user: AdminUser = {
      uuid: generateUuid(),
      username: overrides.username ?? uniqueUsername("mapadm"),
      role: "user",
      approved: true,
      banned: false,
      ...overrides,
    };
    await store.saveUser(user);
    return user;
  };
  return { store, makeUser };
};

const postgresContext = (): AdminDriverContext => {
  const store = new AdminPostgresStore();
  const authStore = new AuthPostgresStore();
  const makeUser = async (
    overrides: Partial<AdminUser> & { username?: string } = {},
  ): Promise<AdminUser> => {
    const seeded: StoredUser = {
      uuid: generateUuid(),
      username: overrides.username ?? uniqueUsername("pgadmct"),
      passwordHash: "hash",
      role: "user",
      approved: true,
      banned: false,
    };
    if (overrides.role !== undefined) seeded.role = overrides.role;
    if (overrides.approved !== undefined) seeded.approved = overrides.approved;
    if (overrides.banned !== undefined) seeded.banned = overrides.banned;
    if (!(await authStore.saveUser(seeded))) {
      throw new Error(`Не удалось создать тестового пользователя ${seeded.username}`);
    }
    trackPostgresUser(seeded);
    return adminView(seeded);
  };
  return { store, makeUser };
};

const collectUsernames = async (store: IAdminStore, filter: UsersFilter): Promise<string[]> => {
  const page = await store.searchUsers(filter);
  return page.items.map((item) => item.username);
};

afterAll(cleanupTrackedUsers);

contractDescribeEach("контракт IAdminStore", (driver) => {
  let ctx: AdminDriverContext;

  beforeEach(() => {
    ctx = driver.driver === "map" ? mapContext() : postgresContext();
  });

  if (driver.driver === "postgres") {
    beforeAll(ensurePostgresSchema);
  }

  it("findByUsername находит сохранённого пользователя", async () => {
    const user = await ctx.makeUser({ approved: false, banned: true, role: "admin" });

    const found = await ctx.store.findByUsername(user.username);

    expect(found?.uuid).toBe(user.uuid);
    expect(found?.role).toBe("admin");
    expect(found?.approved).toBe(false);
    expect(found?.banned).toBe(true);
  });

  it("findByUsername неизвестного пользователя возвращает undefined", async () => {
    expect(await ctx.store.findByUsername(uniqueUsername("missing"))).toBeUndefined();
  });

  it("saveUser при том же uuid обновляет роль и статус", async () => {
    const user = await ctx.makeUser();

    await ctx.store.saveUser({ ...user, role: "admin", approved: false });

    const found = await ctx.store.findByUsername(user.username);
    expect(found?.role).toBe("admin");
    expect(found?.approved).toBe(false);
  });

  it("searchUsers фильтрует по префиксу ника регистронезависимо", async () => {
    const stem = uniqueUsername("srch");
    await ctx.makeUser({ username: `${stem}_Alpha` });
    await ctx.makeUser({ username: `${stem}_beta` });
    const outsider = await ctx.makeUser();

    const items = await collectUsernames(ctx.store, {
      limit: 100,
      offset: 0,
      username: stem.toUpperCase(),
    });

    expect(items).toContain(`${stem}_Alpha`);
    expect(items).toContain(`${stem}_beta`);
    expect(items).not.toContain(outsider.username);
  });

  it("searchUsers фильтрует по approved и считает total", async () => {
    const stem = uniqueUsername("appr");
    await ctx.makeUser({ username: `${stem}_yes`, approved: true });
    await ctx.makeUser({ username: `${stem}_no`, approved: false });

    const page = await ctx.store.searchUsers({
      limit: 100,
      offset: 0,
      username: stem,
      approved: true,
    });

    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.username)).toEqual([`${stem}_yes`]);
  });

  it("searchUsers сортирует по lower(username) и поддерживает пагинацию", async () => {
    const stem = uniqueUsername("sort");
    await ctx.makeUser({ username: `${stem}_BBB` });
    await ctx.makeUser({ username: `${stem}_aaA` });
    await ctx.makeUser({ username: `${stem}_Aab` });
    await ctx.makeUser({ username: `${stem}_ZZZ` });

    const all = await collectUsernames(ctx.store, { limit: 100, offset: 0, username: stem });
    expect(all).toEqual([`${stem}_aaA`, `${stem}_Aab`, `${stem}_BBB`, `${stem}_ZZZ`]);

    const page = await ctx.store.searchUsers({ limit: 2, offset: 1, username: stem });
    expect(page.total).toBe(4);
    expect(page.items.map((item) => item.username)).toEqual([`${stem}_Aab`, `${stem}_BBB`]);
  });

  it("setApproved/setBanned/setRole меняют пользователя по нику", async () => {
    const user = await ctx.makeUser();

    await ctx.store.setApproved(user.username, false);
    await ctx.store.setBanned(user.username, true);
    await ctx.store.setRole(user.username, "admin");

    const found = await ctx.store.findByUsername(user.username);
    expect(found?.approved).toBe(false);
    expect(found?.banned).toBe(true);
    expect(found?.role).toBe("admin");
  });

  it("deleteUser прячет пользователя в живых списках и показывает в удалённых", async () => {
    const user = await ctx.makeUser();

    const removed = await ctx.store.deleteUser(user.username);

    expect(removed?.uuid).toBe(user.uuid);
    expect(await ctx.store.findByUsername(user.username)).toBeUndefined();
    expect(
      await collectUsernames(ctx.store, { limit: 100, offset: 0, username: user.username }),
    ).not.toContain(user.username);

    const deleted = await ctx.store.findDeletedByUsername(user.username);
    expect(deleted?.uuid).toBe(user.uuid);
    expect(Math.abs((deleted?.deletedAt.getTime() ?? 0) - Date.now())).toBeLessThan(5000);

    const deletedPage = await ctx.store.searchDeletedUsers({
      limit: 100,
      offset: 0,
      username: user.username,
    });
    expect(deletedPage.items.map((item) => item.username)).toContain(user.username);
  });

  it("deleteUser неизвестного пользователя возвращает undefined", async () => {
    expect(await ctx.store.deleteUser(uniqueUsername("missing"))).toBeUndefined();
  });

  it("restoreUser возвращает пользователя в живые", async () => {
    const user = await ctx.makeUser();
    await ctx.store.deleteUser(user.username);

    await ctx.store.restoreUser(user.username);

    const restored = await ctx.store.findByUsername(user.username);
    expect(restored?.uuid).toBe(user.uuid);
    expect(await ctx.store.findDeletedByUsername(user.username)).toBeUndefined();
  });

  it("restoreUser при двух удалённых записях восстанавливает новейшую и убирает дубль", async () => {
    const stem = uniqueUsername("dup");
    const first = await ctx.makeUser({ username: stem });
    await ctx.store.deleteUser(stem);
    await Bun.sleep(5);
    const second = await ctx.makeUser({ username: stem });
    await ctx.store.deleteUser(stem);
    await Bun.sleep(5);

    await ctx.store.restoreUser(stem);

    const restored = await ctx.store.findByUsername(stem);
    expect(restored?.uuid).toBe(second.uuid);
    expect(restored?.uuid).not.toBe(first.uuid);
    expect(await ctx.store.findDeletedByUsername(stem)).toBeUndefined();

    const deletedPage = await ctx.store.searchDeletedUsers({
      limit: 100,
      offset: 0,
      username: stem,
    });
    expect(deletedPage.items.map((item) => item.username)).not.toContain(stem);
  });

  it("purgeOldDeletedUsers не вычищает свежеудалённых при retention 30 дней", async () => {
    const user = await ctx.makeUser();
    await ctx.store.deleteUser(user.username);

    await ctx.store.purgeOldDeletedUsers(30);

    expect(await ctx.store.findDeletedByUsername(user.username)).toBeDefined();
  });

  it("hasOwner видит живого овнера", async () => {
    const owner = await ctx.makeUser({ role: "owner" });

    expect(await ctx.store.hasOwner()).toBe(true);

    await ctx.store.deleteUser(owner.username);
    await ctx.store.restoreUser(owner.username);
    expect(await ctx.store.hasOwner()).toBe(true);
  });
});
