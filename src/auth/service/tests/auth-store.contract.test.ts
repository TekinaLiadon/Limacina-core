import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { AuthMapStore } from "../auth_store.service";
import { AuthPostgresStore } from "../auth_postgres.service";
import type { IAuthStore, StoredUser } from "../auth_store.service";
import { MAX_REFRESH_TOKENS_PER_USER } from "../../token.constants";
import { generateUuid } from "../../../utils/uuid";
import {
  cleanupTrackedUsers,
  ensurePostgresSchema,
  trackPostgresUser,
} from "../../../utils/tests/postgres-suite";
import { contractDescribeEach } from "../../../utils/tests/driver-contract";

const HOUR_MS = 60 * 60 * 1000;
const futureExpiry = (): Date => new Date(Date.now() + HOUR_MS);
const pastExpiry = (): Date => new Date(Date.now() - HOUR_MS);

interface AuthDriverContext {
  store: IAuthStore;
  makeUser: (overrides?: Partial<StoredUser>) => Promise<StoredUser>;
}

const mapContext = (): AuthDriverContext => {
  const store = new AuthMapStore();
  const makeUser = async (overrides: Partial<StoredUser> = {}): Promise<StoredUser> => {
    const user: StoredUser = {
      uuid: generateUuid(),
      username: `mapc_${generateUuid().slice(0, 12)}`,
      passwordHash: "hash",
      role: "user",
      approved: true,
      banned: false,
      ...overrides,
    };
    expect(await store.saveUser(user)).toBe(true);
    return user;
  };
  return { store, makeUser };
};

const postgresContext = (): AuthDriverContext => {
  const store = new AuthPostgresStore();
  const makeUser = async (overrides: Partial<StoredUser> = {}): Promise<StoredUser> => {
    const user: StoredUser = {
      uuid: generateUuid(),
      username: `pgact_${generateUuid().slice(0, 12)}`,
      passwordHash: "hash",
      role: "user",
      approved: true,
      banned: false,
      ...overrides,
    };
    expect(await store.saveUser(user)).toBe(true);
    trackPostgresUser(user);
    return user;
  };
  return { store, makeUser };
};

afterAll(cleanupTrackedUsers);

contractDescribeEach("контракт IAuthStore", (driver) => {
  let ctx: AuthDriverContext;

  beforeEach(() => {
    ctx = driver.driver === "map" ? mapContext() : postgresContext();
  });

  if (driver.driver === "postgres") {
    beforeAll(ensurePostgresSchema);
  }

  it("saveUser сохраняет пользователя, findByUsername находит его по нику", async () => {
    const user = await ctx.makeUser();

    const found = await ctx.store.findByUsername(user.username);

    expect(found?.uuid).toBe(user.uuid);
    expect(found?.username).toBe(user.username);
    expect(found?.passwordHash).toBe(user.passwordHash);
    expect(found?.role).toBe("user");
    expect(found?.approved).toBe(true);
    expect(found?.banned).toBe(false);
  });

  it("findByUsername неизвестного ника возвращает undefined", async () => {
    await ctx.makeUser();

    expect(
      await ctx.store.findByUsername(`missing_${generateUuid().slice(0, 12)}`),
    ).toBeUndefined();
  });

  it("saveUser отклоняет ник, отличающийся только регистром", async () => {
    const user = await ctx.makeUser();

    const impostor = { ...user, uuid: generateUuid(), username: user.username.toUpperCase() };

    expect(await ctx.store.saveUser(impostor)).toBe(false);
    expect((await ctx.store.findByUsername(user.username))?.uuid).toBe(user.uuid);
  });

  it("saveUser при совпадении uuid обновляет пароль", async () => {
    const user = await ctx.makeUser();

    expect(await ctx.store.saveUser({ ...user, passwordHash: "updated-hash" })).toBe(true);
    expect((await ctx.store.findByUsername(user.username))?.passwordHash).toBe("updated-hash");
  });

  it("userExists находит ник регистронезависимо среди живых", async () => {
    const user = await ctx.makeUser();

    expect(await ctx.store.userExists(user.username)).toBe(true);
    expect(await ctx.store.userExists(user.username.toUpperCase())).toBe(true);
    expect(await ctx.store.userExists(`missing_${generateUuid().slice(0, 12)}`)).toBe(false);
  });

  it("setApproved переключает одобрение в обе стороны", async () => {
    const user = await ctx.makeUser();

    await ctx.store.setApproved(user.uuid, false);
    expect((await ctx.store.findByUsername(user.username))?.approved).toBe(false);

    await ctx.store.setApproved(user.uuid, true);
    expect((await ctx.store.findByUsername(user.username))?.approved).toBe(true);
  });

  it("setBanned переключает бан в обе стороны", async () => {
    const user = await ctx.makeUser();

    await ctx.store.setBanned(user.uuid, true);
    expect((await ctx.store.findByUsername(user.username))?.banned).toBe(true);

    await ctx.store.setBanned(user.uuid, false);
    expect((await ctx.store.findByUsername(user.username))?.banned).toBe(false);
  });

  it("updateRole меняет роль", async () => {
    const user = await ctx.makeUser();

    await ctx.store.updateRole(user.uuid, "admin");

    expect((await ctx.store.findByUsername(user.username))?.role).toBe("admin");
  });

  it("replacePassword пишет хеш, метку времени и отзывает refresh-токены", async () => {
    const user = await ctx.makeUser();
    const changedAt = new Date();
    const jti = generateUuid();
    await ctx.store.saveRefresh(
      jti,
      { userId: user.uuid, username: user.username },
      futureExpiry(),
    );

    await ctx.store.replacePassword(user.uuid, "changed-hash", changedAt);

    const found = await ctx.store.findByUsername(user.username);
    expect(found?.passwordHash).toBe("changed-hash");
    const storedAt = found?.passwordChangedAt?.getTime() ?? 0;
    expect(Math.abs(storedAt - changedAt.getTime())).toBeLessThan(2000);
    expect(await ctx.store.findRefresh(jti)).toBeUndefined();
  });

  it("claimRefresh атомарно забирает запись: повторный вызов пуст", async () => {
    const user = await ctx.makeUser();
    const jti = generateUuid();
    await ctx.store.saveRefresh(
      jti,
      { userId: user.uuid, username: user.username },
      futureExpiry(),
    );

    expect(await ctx.store.claimRefresh(jti)).toEqual({
      userId: user.uuid,
      username: user.username,
    });
    expect(await ctx.store.claimRefresh(jti)).toBeUndefined();
    expect(await ctx.store.claimRefresh(generateUuid())).toBeUndefined();
  });

  it("findRefresh возвращает запись по jti, неизвестный jti — undefined", async () => {
    const user = await ctx.makeUser();
    const jti = generateUuid();
    await ctx.store.saveRefresh(
      jti,
      { userId: user.uuid, username: user.username },
      futureExpiry(),
    );

    expect(await ctx.store.findRefresh(jti)).toEqual({
      userId: user.uuid,
      username: user.username,
    });
    expect(await ctx.store.findRefresh(generateUuid())).toBeUndefined();
  });

  it("истёкший refresh-токен не возвращается и не забирается", async () => {
    const user = await ctx.makeUser();
    const jti = generateUuid();
    await ctx.store.saveRefresh(jti, { userId: user.uuid, username: user.username }, pastExpiry());

    expect(await ctx.store.findRefresh(jti)).toBeUndefined();
    expect(await ctx.store.claimRefresh(jti)).toBeUndefined();
  });

  it("saveRefresh вытесняет самый старый токен пользователя сверх лимита", async () => {
    const user = await ctx.makeUser();
    const jtis = Array.from({ length: MAX_REFRESH_TOKENS_PER_USER + 1 }, () => generateUuid());
    for (const [index, jti] of jtis.entries()) {
      await ctx.store.saveRefresh(
        jti,
        { userId: user.uuid, username: user.username },
        futureExpiry(),
      );
      if (index < jtis.length - 1) await Bun.sleep(3);
    }

    expect(await ctx.store.findRefresh(jtis[0]!)).toBeUndefined();
    for (const jti of jtis.slice(1)) {
      expect(await ctx.store.findRefresh(jti)).toBeDefined();
    }
  });

  it("deleteRefresh удаляет только указанный jti", async () => {
    const user = await ctx.makeUser();
    const first = generateUuid();
    const second = generateUuid();
    await ctx.store.saveRefresh(
      first,
      { userId: user.uuid, username: user.username },
      futureExpiry(),
    );
    await ctx.store.saveRefresh(
      second,
      { userId: user.uuid, username: user.username },
      futureExpiry(),
    );

    await ctx.store.deleteRefresh(first);

    expect(await ctx.store.findRefresh(first)).toBeUndefined();
    expect(await ctx.store.findRefresh(second)).toBeDefined();
  });

  it("deleteRefreshByUserId удаляет токены только одного пользователя", async () => {
    const first = await ctx.makeUser();
    const second = await ctx.makeUser();
    const firstJti = generateUuid();
    const secondJti = generateUuid();
    await ctx.store.saveRefresh(
      firstJti,
      { userId: first.uuid, username: first.username },
      futureExpiry(),
    );
    await ctx.store.saveRefresh(
      secondJti,
      { userId: second.uuid, username: second.username },
      futureExpiry(),
    );

    await ctx.store.deleteRefreshByUserId(first.uuid);

    expect(await ctx.store.findRefresh(firstJti)).toBeUndefined();
    expect(await ctx.store.findRefresh(secondJti)).toBeDefined();
  });

  it("deleteUser прячет пользователя, restoreUser возвращает с тем же uuid", async () => {
    const user = await ctx.makeUser();

    await ctx.store.deleteUser(user.uuid);

    expect(await ctx.store.findByUsername(user.username)).toBeUndefined();
    expect(await ctx.store.userExists(user.username)).toBe(false);

    await ctx.store.restoreUser(user.uuid);

    const restored = await ctx.store.findByUsername(user.username);
    expect(restored?.uuid).toBe(user.uuid);
    expect(restored?.passwordHash).toBe(user.passwordHash);
  });

  it("ник удалённого пользователя можно занять заново", async () => {
    const user = await ctx.makeUser();

    await ctx.store.deleteUser(user.uuid);
    const reissued = { ...user, uuid: generateUuid() };
    expect(await ctx.store.saveUser(reissued)).toBe(true);

    const live = await ctx.store.findByUsername(user.username);
    expect(live?.uuid).toBe(reissued.uuid);
  });
});
