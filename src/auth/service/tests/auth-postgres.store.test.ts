import { afterAll, beforeAll, expect, it } from "bun:test";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  postgresDescribe,
} from "../../../utils/tests/postgres-suite";
import { generateUuid } from "../../../utils/uuid";
import { AuthPostgresStore } from "../auth_postgres.service";

const store = new AuthPostgresStore();

const uniqueUsername = (): string => `pgauth_${generateUuid().slice(0, 12)}`;

postgresDescribe("AuthPostgresStore (postgres)", () => {
  beforeAll(async () => {
    await ensurePostgresSchema();
  });

  afterAll(async () => {
    await cleanupTrackedUsers();
  });

  it("сохраняет пользователя и находит его по username", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    const found = await store.findByUsername(saved.username);

    expect(found).toBeDefined();
    expect(found?.uuid).toBe(saved.uuid);
    expect(found?.passwordHash).toBe(saved.passwordHash);
    expect(found?.role).toBe("user");
    expect(found?.approved).toBe(false);
    expect(found?.banned).toBe(false);
    expect(found?.passwordChangedAt).toBeUndefined();
  });

  it("не находит отсутствующего пользователя", async () => {
    expect(await store.findByUsername(uniqueUsername())).toBeUndefined();
  });

  it("отклоняет повторный username с другим uuid", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const impostor = { ...saved, uuid: generateUuid() };

    expect(await store.saveUser(impostor)).toBe(false);

    const found = await store.findByUsername(saved.username);
    expect(found?.uuid).toBe(saved.uuid);
  });

  it("обновляет пароль при совпадении username и uuid", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const updated = { ...saved, passwordHash: "updated-hash" };

    expect(await store.saveUser(updated)).toBe(true);
    expect((await store.findByUsername(saved.username))?.passwordHash).toBe("updated-hash");
  });

  it("userExists различает существующих и отсутствующих", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    expect(await store.userExists(saved.username)).toBe(true);
    expect(await store.userExists(uniqueUsername())).toBe(false);
  });

  it("approveUser одобряет пользователя", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.approveUser(saved.uuid);

    expect((await store.findByUsername(saved.username))?.approved).toBe(true);
  });

  it("updateRole меняет роль пользователя", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.updateRole(saved.uuid, "admin");

    expect((await store.findByUsername(saved.username))?.role).toBe("admin");
  });

  it("updatePasswordHash пишет хеш и метку времени", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const changedAt = new Date();

    await store.updatePasswordHash(saved.uuid, "changed-hash", changedAt);

    const found = await store.findByUsername(saved.username);
    expect(found?.passwordHash).toBe("changed-hash");
    const storedAt = found?.passwordChangedAt?.getTime() ?? 0;
    expect(Math.abs(storedAt - changedAt.getTime())).toBeLessThan(2000);
  });

  it("saveRefresh и findRefresh возвращают запись по jti", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const jti = generateUuid();

    await store.saveRefresh(jti, { userId: saved.uuid, username: saved.username });

    expect(await store.findRefresh(jti)).toEqual({
      userId: saved.uuid,
      username: saved.username,
    });
    expect(await store.findRefresh(generateUuid())).toBeUndefined();
  });

  it("deleteRefresh удаляет только указанный jti", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const first = generateUuid();
    const second = generateUuid();
    await store.saveRefresh(first, { userId: saved.uuid, username: saved.username });
    await store.saveRefresh(second, { userId: saved.uuid, username: saved.username });

    await store.deleteRefresh(first);

    expect(await store.findRefresh(first)).toBeUndefined();
    expect(await store.findRefresh(second)).toBeDefined();
  });

  it("deleteRefreshByUserId удаляет токены только одного пользователя", async () => {
    const first = await createPostgresUser({ usernamePrefix: "pgauth" });
    const second = await createPostgresUser({ usernamePrefix: "pgauth" });
    const firstJti = generateUuid();
    const secondJti = generateUuid();
    await store.saveRefresh(firstJti, { userId: first.uuid, username: first.username });
    await store.saveRefresh(secondJti, { userId: second.uuid, username: second.username });

    await store.deleteRefreshByUserId(first.uuid);

    expect(await store.findRefresh(firstJti)).toBeUndefined();
    expect(await store.findRefresh(secondJti)).toBeDefined();
  });
});
