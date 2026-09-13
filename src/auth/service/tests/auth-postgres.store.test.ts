import { afterAll, beforeAll, expect, it } from "bun:test";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  markPostgresUserDeleted,
  postgresDescribe,
} from "../../../utils/tests/postgres-suite";
import { generateUuid } from "../../../utils/uuid";
import { AuthPostgresStore } from "../auth_postgres.service";
import { execute, TABLES } from "../../../utils/sql";
import { MAX_REFRESH_TOKENS_PER_USER } from "../../token.constants";

const store = new AuthPostgresStore();

const uniqueUsername = (): string => `pgauth_${generateUuid().slice(0, 12)}`;
const HOUR_MS = 60 * 60 * 1000;
const futureExpiry = (): Date => new Date(Date.now() + HOUR_MS);
const pastExpiry = (): Date => new Date(Date.now() - HOUR_MS);

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

  it("userExists находит существующий ник в другом регистре", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    expect(await store.userExists(saved.username.toUpperCase())).toBe(true);
  });

  it("saveUser отклоняет ник, отличающийся только регистром", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const variant = {
      ...saved,
      uuid: generateUuid(),
      username: saved.username.toUpperCase(),
    };

    expect(await store.saveUser(variant)).toBe(false);
    expect(await store.findByUsername(saved.username)).toBeDefined();
    expect(await store.findByUsername(variant.username)).toBeUndefined();
  });

  it("setApproved переключает одобрение в обе стороны", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.setApproved(saved.uuid, true);
    expect((await store.findByUsername(saved.username))?.approved).toBe(true);

    await store.setApproved(saved.uuid, false);
    expect((await store.findByUsername(saved.username))?.approved).toBe(false);
  });

  it("setBanned переключает бан в обе стороны", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.setBanned(saved.uuid, true);
    expect((await store.findByUsername(saved.username))?.banned).toBe(true);

    await store.setBanned(saved.uuid, false);
    expect((await store.findByUsername(saved.username))?.banned).toBe(false);
  });

  it("updateRole меняет роль пользователя", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.updateRole(saved.uuid, "admin");

    expect((await store.findByUsername(saved.username))?.role).toBe("admin");
  });

  it("replacePassword пишет хеш, метку времени и отзывает refresh-токены одной операцией", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const changedAt = new Date();
    const jti = generateUuid();
    await store.saveRefresh(jti, { userId: saved.uuid, username: saved.username }, futureExpiry());

    await store.replacePassword(saved.uuid, "changed-hash", changedAt);

    const found = await store.findByUsername(saved.username);
    expect(found?.passwordHash).toBe("changed-hash");
    const storedAt = found?.passwordChangedAt?.getTime() ?? 0;
    expect(Math.abs(storedAt - changedAt.getTime())).toBeLessThan(2000);
    expect(await store.findRefresh(jti)).toBeUndefined();
  });

  it("claimRefresh атомарно забирает запись: повторный вызов пуст (TASK-9)", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const jti = generateUuid();
    await store.saveRefresh(jti, { userId: saved.uuid, username: saved.username }, futureExpiry());

    expect(await store.claimRefresh(jti)).toEqual({
      userId: saved.uuid,
      username: saved.username,
    });
    expect(await store.claimRefresh(jti)).toBeUndefined();
    expect(await store.findRefresh(jti)).toBeUndefined();
    expect(await store.claimRefresh(generateUuid())).toBeUndefined();
  });

  it("saveRefresh и findRefresh возвращают запись по jti", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const jti = generateUuid();

    await store.saveRefresh(jti, { userId: saved.uuid, username: saved.username }, futureExpiry());

    expect(await store.findRefresh(jti)).toEqual({
      userId: saved.uuid,
      username: saved.username,
    });
    expect(await store.findRefresh(generateUuid())).toBeUndefined();
  });

  it("истёкший refresh-токен не возвращается и не забирается (TASK-17)", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const jti = generateUuid();
    await store.saveRefresh(jti, { userId: saved.uuid, username: saved.username }, pastExpiry());

    expect(await store.findRefresh(jti)).toBeUndefined();
    expect(await store.claimRefresh(jti)).toBeUndefined();
  });

  it("saveRefresh чистит просроченные записи всех пользователей (TASK-17)", async () => {
    const expiredOwner = await createPostgresUser({ usernamePrefix: "pgauth" });
    const saver = await createPostgresUser({ usernamePrefix: "pgauth" });
    const expiredJti = generateUuid();
    await store.saveRefresh(
      expiredJti,
      { userId: expiredOwner.uuid, username: expiredOwner.username },
      pastExpiry(),
    );

    await store.saveRefresh(
      generateUuid(),
      { userId: saver.uuid, username: saver.username },
      futureExpiry(),
    );

    const { rows } = await execute<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${TABLES.refresh_tokens} WHERE jti = $1`,
      [expiredJti],
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("saveRefresh вытесняет самые старые токены сверх лимита (TASK-17)", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const jtis = Array.from({ length: MAX_REFRESH_TOKENS_PER_USER + 1 }, () => generateUuid());
    for (const [index, jti] of jtis.entries()) {
      await store.saveRefresh(
        jti,
        { userId: saved.uuid, username: saved.username },
        futureExpiry(),
      );
      if (index < jtis.length - 1) await Bun.sleep(3);
    }

    expect(await store.findRefresh(jtis[0]!)).toBeUndefined();
    for (const jti of jtis.slice(1)) {
      expect(await store.findRefresh(jti)).toBeDefined();
    }
  });

  it("deleteRefresh удаляет только указанный jti", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    const first = generateUuid();
    const second = generateUuid();
    await store.saveRefresh(
      first,
      { userId: saved.uuid, username: saved.username },
      futureExpiry(),
    );
    await store.saveRefresh(
      second,
      { userId: saved.uuid, username: saved.username },
      futureExpiry(),
    );

    await store.deleteRefresh(first);

    expect(await store.findRefresh(first)).toBeUndefined();
    expect(await store.findRefresh(second)).toBeDefined();
  });

  it("deleteRefreshByUserId удаляет токены только одного пользователя", async () => {
    const first = await createPostgresUser({ usernamePrefix: "pgauth" });
    const second = await createPostgresUser({ usernamePrefix: "pgauth" });
    const firstJti = generateUuid();
    const secondJti = generateUuid();
    await store.saveRefresh(
      firstJti,
      { userId: first.uuid, username: first.username },
      futureExpiry(),
    );
    await store.saveRefresh(
      secondJti,
      { userId: second.uuid, username: second.username },
      futureExpiry(),
    );

    await store.deleteRefreshByUserId(first.uuid);

    expect(await store.findRefresh(firstJti)).toBeUndefined();
    expect(await store.findRefresh(secondJti)).toBeDefined();
  });

  it("удалённый пользователь не находится, ник можно занять заново", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });
    await markPostgresUserDeleted(saved.uuid);

    expect(await store.findByUsername(saved.username)).toBeUndefined();
    expect(await store.userExists(saved.username)).toBe(false);

    const reissued = { ...saved, uuid: generateUuid(), approved: true };
    expect(await store.saveUser(reissued)).toBe(true);

    const live = await store.findByUsername(saved.username);
    expect(live?.uuid).toBe(reissued.uuid);
    expect(live?.approved).toBe(true);
  });

  it("deleteUser помечает пользователя удалённым, не трогая строку (TASK-15)", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.deleteUser(saved.uuid);

    expect(await store.findByUsername(saved.username)).toBeUndefined();
    expect(await store.userExists(saved.username)).toBe(false);
    expect(await store.claimRefresh(generateUuid())).toBeUndefined();
  });

  it("restoreUser снимает флаг удаления у записи с тем же uuid (TASK-15)", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.deleteUser(saved.uuid);
    await store.restoreUser(saved.uuid);

    const restored = await store.findByUsername(saved.username);
    expect(restored?.uuid).toBe(saved.uuid);
    expect(restored?.passwordHash).toBe(saved.passwordHash);
  });

  it("повторные deleteUser и restoreUser идемпотентны", async () => {
    const saved = await createPostgresUser({ usernamePrefix: "pgauth" });

    await store.deleteUser(saved.uuid);
    await store.deleteUser(saved.uuid);
    await store.restoreUser(saved.uuid);
    await store.restoreUser(saved.uuid);

    expect(await store.findByUsername(saved.username)).toBeDefined();
  });
});
