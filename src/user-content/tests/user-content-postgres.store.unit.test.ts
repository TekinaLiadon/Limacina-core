import { afterAll, describe, expect, it } from "bun:test";
import { UserContentPostgresStore, isUserContentLimitExceededError } from "../user-content.store";
import { installFakeSqlClient, resetSqlClient } from "../../utils/tests/sql-fake";
import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

const fake = installFakeSqlClient();
afterAll(resetSqlClient);

const store = new UserContentPostgresStore();

function contentRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    user_uuid: "uuid-1",
    file_path: "http://localhost:3005/textures/skin.png",
    skin_model: "slim",
    active: true,
    ...overrides,
  };
}

function lastCalls(count: number) {
  return fake.sqlCalls.slice(fake.sqlCalls.length - count);
}

describe("UserContentPostgresStore (мок SQL-клиента)", () => {
  it("countByUserUuid выбирает таблицу по типу контента", async () => {
    fake.onSql(() => [{ count: "5" }]);

    expect(await store.countByUserUuid("uuid-1", "skin")).toBe(5);
    expect(await store.countByUserUuid("uuid-1", "cape")).toBe(5);
    expect(await store.countByUserUuid("uuid-1", "model")).toBe(5);

    const calls = lastCalls(3);
    expect(calls[0]?.sql).toContain("FROM user_skins");
    expect(calls[1]?.sql).toContain("FROM user_capes");
    expect(calls[2]?.sql).toContain("FROM user_models");
    expect(calls[0]?.values).toEqual(["uuid-1"]);
  });

  it("countByFilePath без строк отвечает 0", async () => {
    fake.onSql(() => []);

    expect(await store.countByFilePath("http://localhost:3005/textures/none.png", "cape")).toBe(0);
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("file_path = $1");
  });

  it("findByUserUuid для скина выбирает колонки модели и активности", async () => {
    fake.onSql(() => [contentRow()]);

    const items = await store.findByUserUuid("uuid-1", "skin");

    expect(items[0]).toEqual({
      id: 1,
      userUuid: "uuid-1",
      filePath: "http://localhost:3005/textures/skin.png",
      skinModel: "slim",
      active: true,
    });
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("skin_model, active");
  });

  it("findByUserUuid для плаща не выбирает skin_model и active", async () => {
    fake.onSql(() => [contentRow({ skin_model: null, active: false })]);

    const items = await store.findByUserUuid("uuid-1", "cape");

    expect(items[0]).toEqual({
      id: 1,
      userUuid: "uuid-1",
      filePath: "http://localhost:3005/textures/skin.png",
      skinModel: null,
      active: false,
    });
    const [call] = lastCalls(1);
    expect(call?.sql).not.toContain("skin_model");
  });

  it("findById находит и не находит запись", async () => {
    fake.onSql(() => [contentRow({ id: 42 })]);
    expect((await store.findById(42, "skin"))?.id).toBe(42);

    fake.onSql(() => []);
    expect(await store.findById(43, "skin")).toBeUndefined();
  });

  it("save скина вставляет с активностью false и моделью", async () => {
    fake.onSql(() => [contentRow({ id: 7, active: false })]);

    const item = await store.save(
      "uuid-1",
      "http://localhost:3005/textures/skin.png",
      "skin",
      "classic",
    );

    expect(item.id).toBe(7);
    expect(item.active).toBe(false);
    expect(item.skinModel).toBe("slim");
    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INSERT INTO user_skins");
    expect(call?.values).toEqual([
      "uuid-1",
      "http://localhost:3005/textures/skin.png",
      "classic",
      false,
    ]);
  });

  it("save скина без модели пишет null", async () => {
    fake.onSql(() => [contentRow({ id: 8, skin_model: null })]);

    const item = await store.save("uuid-1", "http://localhost:3005/textures/skin.png", "skin");

    expect(item.skinModel).toBeNull();
    const [call] = lastCalls(1);
    expect(call?.values).toEqual([
      "uuid-1",
      "http://localhost:3005/textures/skin.png",
      null,
      false,
    ]);
  });

  it("save плаща вставляет без колонок скина", async () => {
    fake.onSql(() => [contentRow({ id: 9 })]);

    await store.save("uuid-1", "http://localhost:3005/capes/c.png", "cape");

    const [call] = lastCalls(1);
    expect(call?.sql).toContain("INSERT INTO user_capes");
    expect(call?.sql).not.toContain("skin_model");
    expect(call?.values).toEqual(["uuid-1", "http://localhost:3005/capes/c.png"]);
  });

  it("saveWithinLimit вставляет при свободном лимите", async () => {
    fake.onSql(({ sql }) => (sql.includes("INSERT INTO") ? [contentRow({ id: 10 })] : []));

    const item = await store.saveWithinLimit(
      "uuid-1",
      "http://localhost:3005/textures/skin.png",
      "skin",
      1,
    );

    expect(item.id).toBe(10);
    const [lock, insert] = lastCalls(2);
    expect(lock?.sql).toContain("FOR UPDATE");
    expect(insert?.sql).toContain("INSERT INTO user_skins");
    expect(insert?.sql).toContain("RETURNING id, user_uuid, file_path, skin_model, active");
  });

  it("saveWithinLimit превышение лимита даёт маркерную ошибку", async () => {
    fake.onSql(() => []);

    let caught: unknown;
    try {
      await store.saveWithinLimit("uuid-1", "http://localhost:3005/textures/skin.png", "skin", 1);
    } catch (error) {
      caught = error;
    }

    expect(isUserContentLimitExceededError(caught)).toBeTrue();
    const [, insert] = lastCalls(2);
    expect(insert?.sql).toContain("INSERT INTO user_skins");
  });

  it("updateActiveSkin деактивирует и активирует в одной транзакции", async () => {
    fake.onSql(() => []);

    await store.updateActiveSkin("uuid-1", 42);

    const [deactivate, activate] = lastCalls(2);
    expect(deactivate?.sql).toContain("UPDATE user_skins SET active = $1");
    expect(deactivate?.values).toEqual([false, "uuid-1"]);
    expect(activate?.sql).toContain("WHERE id = $2");
    expect(activate?.values).toEqual([true, 42]);
  });

  it("deleteByIdAndCountRemaining возвращает удалённое и остаток ссылок", async () => {
    fake.onSql(({ sql }) => {
      if (sql.includes("SELECT id, user_uuid, file_path")) return [contentRow({ id: 11 })];
      if (sql.includes("DELETE FROM")) return [contentRow({ id: 11 })];
      return [{ same_path_total: "3" }];
    });

    const result = await store.deleteByIdAndCountRemaining(11, "skin");

    expect(result?.item.id).toBe(11);
    expect(result?.remainingCount).toBe(2);
    const [count] = lastCalls(2);
    expect(count?.sql).toContain("SELECT COUNT(*) AS same_path_total");
    expect(count?.values).toEqual(["http://localhost:3005/textures/skin.png"]);
  });

  it("deleteByIdAndCountRemaining при сбое удаления отвечает undefined", async () => {
    fake.onSql(({ sql }) => {
      if (sql.includes("SELECT id, user_uuid, file_path")) return [contentRow({ id: 11 })];
      return [];
    });

    expect(await store.deleteByIdAndCountRemaining(11, "cape")).toBeUndefined();
  });

  it("deleteByIdAndCountRemaining несуществующей записи отвечает undefined", async () => {
    fake.onSql(() => []);

    expect(await store.deleteByIdAndCountRemaining(999, "cape")).toBeUndefined();
    expect(lastCalls(1)[0]?.sql).toContain("SELECT id, user_uuid, file_path");
  });
});
