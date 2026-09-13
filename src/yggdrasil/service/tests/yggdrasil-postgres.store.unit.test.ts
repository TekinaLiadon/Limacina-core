import { afterAll, describe, expect, it } from "bun:test";
import { YggdrasilPostgresStore } from "../yggdrasil_postgres";
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

  it("saveProfile вставляет текстуры с null-подстановкой", async () => {
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
    expect(call?.values).toEqual([
      "profile-uuid",
      "http://localhost:3005/textures/skin.png",
      null,
      null,
    ]);
  });

  it("updateProfileTexture без полей не выполняет запрос", async () => {
    fake.onSql(() => []);
    const before = fake.sqlCalls.length;

    await store.updateProfileTexture("profile-uuid", {});

    expect(fake.sqlCalls.length).toBe(before);
  });

  it("updateProfileTexture при отсутствии профиля вставляет строку", async () => {
    fake.onSql(({ sql }) => (sql.includes("SELECT uuid FROM") ? [] : []));

    await store.updateProfileTexture("profile-uuid", {
      capeUrl: "http://localhost:3005/capes/c.png",
    });

    const insert = lastCalls(2)[1];
    expect(insert?.sql).toContain("INSERT INTO user_textures");
    expect(insert?.sql).not.toContain("ON CONFLICT");
    expect(insert?.values).toEqual(["profile-uuid", "http://localhost:3005/capes/c.png"]);
  });

  it("updateProfileTexture при существующем профиле обновляет поля", async () => {
    fake.onSql(({ sql }) => (sql.includes("SELECT uuid FROM") ? [{ uuid: "profile-uuid" }] : []));

    await store.updateProfileTexture("profile-uuid", {
      capeUrl: "http://localhost:3005/capes/c.png",
    });

    const update = lastCalls(2)[1];
    expect(update?.sql).toContain("UPDATE user_textures SET cape_url = $1");
    expect(update?.values).toEqual(["http://localhost:3005/capes/c.png", "profile-uuid"]);
  });

  it("updateProfileTexture пишет кожу с моделью и плащ", async () => {
    fake.onSql(({ sql }) => (sql.includes("SELECT uuid FROM") ? [] : []));

    await store.updateProfileTexture("profile-uuid", {
      skinUrl: "http://localhost:3005/textures/skin.png",
      skinModel: "classic",
      capeUrl: null,
    });

    const insert = lastCalls(2)[1];
    expect(insert?.sql).toContain("INSERT INTO user_textures");
    expect(insert?.values).toEqual([
      "profile-uuid",
      "http://localhost:3005/textures/skin.png",
      "classic",
      null,
    ]);
  });

  it("countProfilesByTextureUrl считает ссылки на файл", async () => {
    fake.onSql(() => [{ count: "3" }]);

    expect(await store.countProfilesByTextureUrl("http://localhost:3005/textures/skin.png")).toBe(
      3,
    );
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("skin_url = $1 OR cape_url = $1");
  });

  it("countProfilesByTextureUrl без строк отвечает 0", async () => {
    fake.onSql(() => []);

    expect(await store.countProfilesByTextureUrl("http://localhost:3005/textures/none.png")).toBe(
      0,
    );
  });

  it("findUserByUsername маппит креды", async () => {
    fake.onSql(() => [
      {
        uuid: "profile-uuid",
        password_hash: "hash",
        banned: true,
        approved: false,
      },
    ]);

    const creds = await store.findUserByUsername("pgygg_user");

    expect(creds).toEqual({
      uuid: "profile-uuid",
      passwordHash: "hash",
      banned: true,
      approved: false,
    });
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("FROM users WHERE username = $1");
  });

  it("findUserByUsername без строк отвечает undefined", async () => {
    fake.onSql(() => []);

    expect(await store.findUserByUsername("unknown")).toBeUndefined();
  });
});
