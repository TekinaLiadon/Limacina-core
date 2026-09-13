import { afterAll, describe, expect, it } from "bun:test";
import { AuthPostgresStore } from "../auth_postgres.service";
import type { StoredUser } from "../auth_store.service";
import { MAX_REFRESH_TOKENS_PER_USER } from "../../token.constants";
import { installFakeSqlClient, resetSqlClient, type SqlCall } from "../../../utils/tests/sql-fake";
import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

const fake = installFakeSqlClient();
afterAll(resetSqlClient);

const store = new AuthPostgresStore();

function userRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    uuid: "uuid-1",
    username: "pgauth_user",
    password_hash: "hash",
    role: "user",
    approved: true,
    banned: false,
    password_changed_at: null,
    ...overrides,
  };
}

function storedUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    uuid: "uuid-1",
    username: "pgauth_user",
    passwordHash: "hash",
    role: "user",
    approved: true,
    banned: false,
    ...overrides,
  };
}

function lastCalls(count: number): SqlCall[] {
  return fake.sqlCalls.slice(fake.sqlCalls.length - count);
}

describe("AuthPostgresStore (мок SQL-клиента)", () => {
  it("findByUsername маппит строку пользователя", async () => {
    const changedAt = new Date("2026-01-02T03:04:05Z");
    fake.onSql(() => [userRow({ password_changed_at: changedAt })]);

    const user = await store.findByUsername("pgauth_user");

    expect(user).toEqual({
      uuid: "uuid-1",
      username: "pgauth_user",
      passwordHash: "hash",
      role: "user",
      approved: true,
      banned: false,
      passwordChangedAt: changedAt,
    });
  });

  it("findByUsername с null password_changed_at не задаёт метку", async () => {
    fake.onSql(() => [userRow()]);

    const user = await store.findByUsername("pgauth_user");

    expect(user?.passwordChangedAt).toBeUndefined();
  });

  it("findByUsername без строк отвечает undefined", async () => {
    fake.onSql(() => []);

    const user = await store.findByUsername("unknown");

    expect(user).toBeUndefined();
  });

  it("userExists отвечает true только при ненулевом результате", async () => {
    fake.onSql(() => [userRow()]);
    expect(await store.userExists("pgauth_user")).toBeTrue();

    fake.onSql(() => []);
    expect(await store.userExists("pgauth_user")).toBeFalse();
  });

  it("saveUser при успешной вставке возвращает true", async () => {
    fake.onSql(({ sql }) => (sql.includes("RETURNING uuid") ? [{ uuid: "uuid-1" }] : []));

    const inserted = await store.saveUser(storedUser());

    expect(inserted).toBeTrue();
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INSERT INTO users");
    expect(call?.values).toEqual(["uuid-1", "pgauth_user", "hash", "user", true, false, null]);
  });

  it("saveUser при unique violation возвращает false", async () => {
    fake.onSql(() => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });

    const inserted = await store.saveUser(storedUser());

    expect(inserted).toBeFalse();
  });

  it("saveUser перекидывает не-unique ошибки", async () => {
    fake.onSql(() => {
      throw new Error("connection refused");
    });

    expect(store.saveUser(storedUser())).rejects.toThrow("connection refused");
  });

  it("saveUser при конфликте обновляет существующую запись по uuid", async () => {
    fake.onSql(({ sql }) => {
      if (sql.includes("RETURNING uuid")) return [];
      return [{ username: "pgauth_user" }];
    });

    const inserted = await store.saveUser(storedUser({ passwordHash: "new-hash" }));

    expect(inserted).toBeTrue();
    const [, update] = lastCalls(2);
    expect(update?.sql).toContain("UPDATE users SET password_hash = $1");
    expect(update?.values).toEqual(["new-hash", "uuid-1"]);
  });

  it("saveUser при конфликте с другим ником возвращает false", async () => {
    fake.onSql(({ sql }) => {
      if (sql.includes("RETURNING uuid")) return [];
      return [{ username: "someone-else" }];
    });

    expect(await store.saveUser(storedUser())).toBeFalse();
  });

  it("replacePassword атомарно обновляет хеш и отзывает refresh-токены", async () => {
    fake.onSql(() => []);

    await store.replacePassword("uuid-1", "new-hash", new Date("2026-01-01T00:00:00Z"));

    const calls = lastCalls(2);
    expect(calls[0]?.sql).toContain("UPDATE users SET password_hash = $1");
    expect(calls[0]?.sql).toContain("password_changed_at = $2");
    expect(calls[0]?.values).toEqual(["new-hash", new Date("2026-01-01T00:00:00Z"), "uuid-1"]);
    expect(calls[1]?.sql).toContain("DELETE FROM refresh_tokens WHERE user_id = $1");
  });

  it("saveRefresh пишет токен и чистит просроченные и сверх лимита", async () => {
    fake.onSql(() => []);
    const expiresAt = new Date("2027-01-01T00:00:00Z");

    await store.saveRefresh("jti-1", { userId: "uuid-1", username: "pgauth_user" }, expiresAt);

    const calls = lastCalls(3);
    expect(calls[0]?.sql).toContain("INSERT INTO refresh_tokens");
    expect(calls[0]?.values).toEqual(["jti-1", "uuid-1", "pgauth_user", expiresAt]);
    expect(calls[1]?.sql).toContain("DELETE FROM refresh_tokens WHERE expires_at <= now()");
    expect(calls[2]?.sql).toContain("NOT IN");
    expect(calls[2]?.values).toEqual(["uuid-1", MAX_REFRESH_TOKENS_PER_USER]);
  });

  it("claimRefresh забирает токен и возвращает запись", async () => {
    fake.onSql(() => [{ user_id: "uuid-1", username: "pgauth_user" }]);

    const entry = await store.claimRefresh("jti-1");

    expect(entry).toEqual({ userId: "uuid-1", username: "pgauth_user" });
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("DELETE FROM refresh_tokens WHERE jti = $1 AND expires_at > now()");
    expect(call?.sql).toContain("RETURNING user_id, username");
    expect(call?.values).toEqual(["jti-1"]);
  });

  it("claimRefresh без строк отвечает undefined", async () => {
    fake.onSql(() => []);

    expect(await store.claimRefresh("jti-miss")).toBeUndefined();
  });

  it("findRefresh читает запись без удаления", async () => {
    fake.onSql(() => [{ user_id: "uuid-1", username: "pgauth_user" }]);

    const entry = await store.findRefresh("jti-1");

    expect(entry).toEqual({ userId: "uuid-1", username: "pgauth_user" });
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("SELECT user_id, username FROM refresh_tokens");
  });

  it("deleteRefresh и deleteRefreshByUserId удаляют по ключам", async () => {
    fake.onSql(() => []);

    await store.deleteRefresh("jti-1");
    await store.deleteRefreshByUserId("uuid-1");

    const [byJti, byUser] = lastCalls(2);
    expect(byJti?.sql).toContain("DELETE FROM refresh_tokens WHERE jti = $1");
    expect(byJti?.values).toEqual(["jti-1"]);
    expect(byUser?.sql).toContain("DELETE FROM refresh_tokens WHERE user_id = $1");
    expect(byUser?.values).toEqual(["uuid-1"]);
  });

  it("setApproved/setBanned/updateRole обновляют по uuid", async () => {
    fake.onSql(() => []);

    await store.setApproved("uuid-1", false);
    await store.setBanned("uuid-1", true);
    await store.updateRole("uuid-1", "admin");

    const calls = lastCalls(3);
    expect(calls[0]?.sql).toContain("UPDATE users SET approved = $1");
    expect(calls[0]?.values).toEqual([false, "uuid-1"]);
    expect(calls[1]?.sql).toContain("UPDATE users SET banned = $1");
    expect(calls[1]?.values).toEqual([true, "uuid-1"]);
    expect(calls[2]?.sql).toContain("UPDATE users SET role = $1");
    expect(calls[2]?.values).toEqual(["admin", "uuid-1"]);
  });

  it("deleteUser/restoreUser переключают флаг deleted", async () => {
    fake.onSql(() => []);

    await store.deleteUser("uuid-1");
    await store.restoreUser("uuid-1");

    const [deleted, restored] = lastCalls(2);
    expect(deleted?.sql).toContain("SET deleted = $1");
    expect(deleted?.sql).toContain("deleted = false");
    expect(deleted?.values[0]).toBe(true);
    expect(deleted?.values[1]).toBeInstanceOf(Date);
    expect(restored?.sql).toContain("SET deleted = $1");
    expect(restored?.sql).toContain("deleted = true");
    expect(restored?.values).toEqual([false, null, "uuid-1"]);
  });
});
