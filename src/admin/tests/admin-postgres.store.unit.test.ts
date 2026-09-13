import { afterAll, describe, expect, it } from "bun:test";
import { AdminPostgresStore } from "../admin_postgres.store";
import type { AdminUser } from "../admin.store";
import { installFakeSqlClient, resetSqlClient } from "../../utils/tests/sql-fake";
import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

const fake = installFakeSqlClient();
afterAll(resetSqlClient);

const store = new AdminPostgresStore();

function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    uuid: "uuid-1",
    username: "pgadm_user",
    role: "user",
    approved: true,
    banned: false,
    ...overrides,
  };
}

function userRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    uuid: "uuid-1",
    username: "pgadm_user",
    role: "user",
    approved: true,
    banned: false,
    ...overrides,
  };
}

function deletedRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ...userRow(),
    deleted_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function lastCalls(count: number) {
  return fake.sqlCalls.slice(fake.sqlCalls.length - count);
}

describe("AdminPostgresStore (мок SQL-клиента)", () => {
  it("findByUsername маппит строку, при отсутствии — undefined", async () => {
    fake.onSql(() => [userRow()]);
    expect(await store.findByUsername("pgadm_user")).toEqual(adminUser());

    fake.onSql(() => []);
    expect(await store.findByUsername("unknown")).toBeUndefined();
  });

  it("saveUser обновляет существующего пользователя", async () => {
    fake.onSql(({ sql }) => (sql.includes("SELECT") ? [userRow()] : []));

    await store.saveUser(adminUser({ role: "admin" }));

    const [, update] = lastCalls(2);
    expect(update?.sql).toContain("UPDATE users SET uuid = $1");
    expect(update?.values).toEqual(["uuid-1", "admin", true, false, "pgadm_user"]);
  });

  it("saveUser вставляет нового пользователя", async () => {
    fake.onSql(() => []);

    await store.saveUser(adminUser({ username: "pgadm_new" }));

    const [, insert] = lastCalls(2);
    expect(insert?.sql).toContain("INSERT INTO users");
    expect(insert?.values).toEqual(["uuid-1", "pgadm_new", "user", true, false]);
  });

  it("searchUsers применяет фильтры и считает total", async () => {
    fake.onSql(({ sql }) =>
      sql.includes("count(*)") ? [{ total: "7" }] : [userRow(), userRow({ uuid: "uuid-2" })],
    );

    const page = await store.searchUsers({ username: "pg", approved: true, limit: 10, offset: 5 });

    expect(page.total).toBe(7);
    expect(page.items).toEqual([adminUser(), adminUser({ uuid: "uuid-2" })]);
    const [items, count] = lastCalls(2);
    expect(items?.sql).toContain("ORDER BY lower(username) ASC");
    expect(items?.sql).toContain("LIMIT 10");
    expect(items?.sql).toContain("OFFSET 5");
    expect(items?.values).toEqual(["pg%", true]);
    expect(count?.sql).toContain("count(*) AS total");
    expect(count?.values).toEqual(["pg%", true]);
  });

  it("searchUsers без фильтров не добавляет условий", async () => {
    fake.onSql(({ sql }) => (sql.includes("count(*)") ? [{ total: 0 }] : []));

    const page = await store.searchUsers({ limit: 20, offset: 0 });

    expect(page.total).toBe(0);
    const [items] = lastCalls(2);
    expect(items?.values).toEqual([]);
  });

  it("searchDeletedUsers возвращает удалённых с датой", async () => {
    fake.onSql(({ sql }) =>
      sql.includes("count(*)")
        ? [{ total: "1" }]
        : [deletedRow({ username: "pgadm_gone", role: "admin", banned: true })],
    );

    const page = await store.searchDeletedUsers({ limit: 10, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      uuid: "uuid-1",
      username: "pgadm_gone",
      role: "admin",
      approved: true,
      banned: true,
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const [items] = lastCalls(2);
    expect(items?.sql).toContain("deleted = true");
  });

  it("setApproved/setBanned/setRole обновляют живого пользователя", async () => {
    fake.onSql(() => []);

    await store.setApproved("pgadm_user", false);
    await store.setBanned("pgadm_user", true);
    await store.setRole("pgadm_user", "admin");

    const calls = lastCalls(3);
    expect(calls[0]?.sql).toContain("UPDATE users SET approved = $1");
    expect(calls[0]?.values).toEqual([false, "pgadm_user"]);
    expect(calls[1]?.sql).toContain("UPDATE users SET banned = $1");
    expect(calls[1]?.values).toEqual([true, "pgadm_user"]);
    expect(calls[2]?.sql).toContain("UPDATE users SET role = $1");
    expect(calls[2]?.values).toEqual(["admin", "pgadm_user"]);
  });

  it("deleteUser возвращает пользователя при успешном удалении", async () => {
    fake.onSql(({ sql }) => (sql.includes("SELECT") ? [userRow()] : []));

    const deleted = await store.deleteUser("pgadm_user");

    expect(deleted).toEqual(adminUser());
    const update = lastCalls(2)[1];
    expect(update?.sql).toContain("UPDATE users SET deleted = $1");
    expect(update?.sql).not.toContain("RETURNING");
  });

  it("deleteUser несуществующего не выполняет удаление", async () => {
    fake.onSql(() => []);

    expect(await store.deleteUser("unknown")).toBeUndefined();
    expect(lastCalls(1)[0]?.sql).toContain("SELECT");
  });

  it("findDeletedByUsername маппит удалённого", async () => {
    fake.onSql(() => [deletedRow({ deleted_at: new Date("2026-02-03T00:00:00Z") })]);

    const deleted = await store.findDeletedByUsername("pgadm_user");

    expect(deleted?.deletedAt).toEqual(new Date("2026-02-03T00:00:00Z"));
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("deleted = true");
    expect(call?.sql).toContain("ORDER BY deleted_at DESC");
    expect(call?.sql).toContain("LIMIT 1");
  });

  it("restoreUser восстанавливает новейшую запись и чистит дубли", async () => {
    fake.onSql(({ sql }) => (sql.includes("SELECT") ? [deletedRow()] : []));

    await store.restoreUser("pgadm_user");

    const [restore, cleanup] = lastCalls(2);
    expect(restore?.sql).toContain("SET deleted = $1");
    expect(restore?.sql).toContain("ORDER BY deleted_at DESC LIMIT 1");
    expect(cleanup?.sql).toContain("DELETE FROM users");
    expect(cleanup?.sql).toContain("deleted = true");
  });

  it("restoreUser отсутствующего ничего не делает", async () => {
    fake.onSql(() => []);

    await store.restoreUser("unknown");

    expect(lastCalls(1)[0]?.sql).toContain("SELECT");
  });

  it("purgeOldDeletedUsers возвращает число удалённых", async () => {
    fake.onSql(() => [{ uuid: "uuid-1" }, { uuid: "uuid-2" }]);

    expect(await store.purgeOldDeletedUsers(30)).toBe(2);
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("DELETE FROM users");
    expect(call?.sql).not.toContain("make_interval");
    expect(call?.values[0]).toBeInstanceOf(Date);
  });

  it("hasOwner отвечает по наличию owner-строки", async () => {
    fake.onSql(() => [{ "?column?": 1 }]);
    expect(await store.hasOwner()).toBeTrue();

    fake.onSql(() => []);
    expect(await store.hasOwner()).toBeFalse();
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("role = $1");
  });
});
