import { afterAll, describe, expect, it } from "bun:test";
import { YggdrasilPostgresStore } from "../yggdrasil_postgres_store";
import { installFakeSqlClient, resetSqlClient } from "../../../utils/tests/sql-fake";
import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

const fake = installFakeSqlClient();
afterAll(resetSqlClient);

const store = new YggdrasilPostgresStore();

function profileRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    uuid: "profile-uuid",
    user_id: "profile-uuid",
    username: "pgygg_user",
    skin_url: "http://localhost:3005/textures/skin.png",
    skin_model: "slim",
    cape_url: null,
    ...overrides,
  };
}

function lastCalls(count: number) {
  return fake.sqlCalls.slice(fake.sqlCalls.length - count);
}

describe("YggdrasilPostgresStore (мок SQL-клиента)", () => {
  it("findProfileByUuid маппит строку профиля", async () => {
    fake.onSql(() => [profileRow()]);

    const profile = await store.findProfileByUuid("profile-uuid");

    expect(profile).toEqual({
      uuid: "profile-uuid",
      userId: "profile-uuid",
      username: "pgygg_user",
      skinUrl: "http://localhost:3005/textures/skin.png",
      skinModel: "slim",
      capeUrl: null,
    });
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("LEFT JOIN user_textures t ON t.uuid = u.uuid");
    expect(call?.sql).toContain("u.deleted = false");
  });

  it("findProfileByUuid без строк отвечает undefined", async () => {
    fake.onSql(() => []);

    expect(await store.findProfileByUuid("unknown")).toBeUndefined();
  });

  it("findProfileByUsername ищет по нику", async () => {
    fake.onSql(() => [profileRow()]);

    const profile = await store.findProfileByUsername("pgygg_user");

    expect(profile?.username).toBe("pgygg_user");
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("u.username = $1");
  });

  it("findProfilesByUserId возвращает список профилей", async () => {
    fake.onSql(() => [profileRow(), profileRow({ username: "pgygg_alt" })]);

    const profiles = await store.findProfilesByUserId("profile-uuid");

    expect(profiles).toHaveLength(2);
    expect(profiles[1]?.username).toBe("pgygg_alt");
  });

  it("findProfilesByUsernames с пустым списком не ходит в базу", async () => {
    fake.onSql(() => []);
    const before = fake.sqlCalls.length;

    expect(await store.findProfilesByUsernames([])).toEqual([]);
    expect(fake.sqlCalls.length).toBe(before);
  });

  it("findProfilesByUsernames собирает IN-условие", async () => {
    fake.onSql(() => [profileRow()]);

    const profiles = await store.findProfilesByUsernames(["a", "b", "c"]);

    expect(profiles).toHaveLength(1);
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("u.username IN ($1, $2, $3)");
    expect(call?.values).toEqual(["a", "b", "c"]);
  });

  it("saveProfile вставляет текстуры с null-подстановкой upsert-запросом", async () => {
    fake.onSql(() => []);

    await store.saveProfile({
      uuid: "profile-uuid",
      userId: "profile-uuid",
      username: "pgygg_user",
      skinUrl: "http://localhost:3005/textures/skin.png",
      skinModel: null,
      capeUrl: null,
    });

    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INSERT INTO user_textures");
    expect(call?.sql).toContain("ON CONFLICT (uuid) DO UPDATE SET");
    expect(call?.values).toEqual([
      "profile-uuid",
      "http://localhost:3005/textures/skin.png",
      null,
      null,
    ]);
  });

  it("saveProfile по существующему uuid не падает unique violation (повторный вызов)", async () => {
    fake.onSql(() => []);
    const before = fake.sqlCalls.length;

    await store.saveProfile({
      uuid: "profile-uuid",
      userId: "profile-uuid",
      username: "pgygg_user",
    });
    await store.saveProfile({
      uuid: "profile-uuid",
      userId: "profile-uuid",
      username: "pgygg_user",
      capeUrl: "http://localhost:3005/capes/c.png",
    });

    expect(fake.sqlCalls.length).toBe(before + 2);
    const [first, second] = lastCalls(2);
    expect(first?.values).toEqual(["profile-uuid", null, null, null]);
    expect(second?.values).toEqual([
      "profile-uuid",
      null,
      null,
      "http://localhost:3005/capes/c.png",
    ]);
  });

  it("updateProfileTexture без полей не выполняет запрос", async () => {
    fake.onSql(() => []);
    const before = fake.sqlCalls.length;

    await store.updateProfileTexture("profile-uuid", {});

    expect(fake.sqlCalls.length).toBe(before);
  });

  it("updateProfileTexture при отсутствии профиля вставляет строку upsert-запросом", async () => {
    fake.onSql(() => []);

    await store.updateProfileTexture("profile-uuid", {
      capeUrl: "http://localhost:3005/capes/c.png",
    });

    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INSERT INTO user_textures");
    expect(call?.sql).toContain("ON CONFLICT (uuid) DO UPDATE SET");
    expect(call?.values).toEqual(["profile-uuid", "http://localhost:3005/capes/c.png"]);
  });

  it("updateProfileTexture не делает предварительный SELECT — один атомарный запрос", async () => {
    fake.onSql(() => []);
    const before = fake.sqlCalls.length;

    await store.updateProfileTexture("profile-uuid", {
      capeUrl: "http://localhost:3005/capes/c.png",
    });

    expect(fake.sqlCalls.length).toBe(before + 1);
  });

  it("updateProfileTexture пишет кожу с моделью и плащ", async () => {
    fake.onSql(() => []);

    await store.updateProfileTexture("profile-uuid", {
      skinUrl: "http://localhost:3005/textures/skin.png",
      skinModel: "classic",
      capeUrl: null,
    });

    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INSERT INTO user_textures");
    expect(call?.values).toEqual([
      "profile-uuid",
      "http://localhost:3005/textures/skin.png",
      "classic",
      null,
    ]);
  });

  it("countProfilesByTextureUrl джойнит пользователей и фильтрует удалённых", async () => {
    fake.onSql(() => [{ count: "3" }]);

    expect(await store.countProfilesByTextureUrl("http://localhost:3005/textures/skin.png")).toBe(
      3,
    );
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INNER JOIN users u ON u.uuid = t.uuid");
    expect(call?.sql).toContain("u.deleted = false");
    expect(call?.sql).toContain("(t.skin_url = $1 OR t.cape_url = $1)");
  });

  it("countProfilesByTextureUrl без строк отвечает 0", async () => {
    fake.onSql(() => []);

    expect(await store.countProfilesByTextureUrl("http://localhost:3005/textures/none.png")).toBe(
      0,
    );
  });

  it("findUserByUsername маппит креды", async () => {
    const changedAt = new Date("2026-01-01T00:00:00Z");
    fake.onSql(() => [
      {
        uuid: "profile-uuid",
        password_hash: "hash",
        banned: true,
        approved: false,
        password_changed_at: changedAt,
      },
    ]);

    const creds = await store.findUserByUsername("pgygg_user");

    expect(creds).toEqual({
      uuid: "profile-uuid",
      passwordHash: "hash",
      banned: true,
      approved: false,
      passwordChangedAt: changedAt,
    });
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("FROM users WHERE username = $1");
    expect(call?.sql).toContain("password_changed_at");
  });

  it("findUserByUsername без строк отвечает undefined", async () => {
    fake.onSql(() => []);

    expect(await store.findUserByUsername("unknown")).toBeUndefined();
  });
});
