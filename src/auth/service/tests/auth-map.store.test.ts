import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { AuthMapStore } from "../auth_store.service";
import { MAX_REFRESH_TOKENS_PER_USER } from "../../token.constants";
import { generateUuid } from "../../../utils/uuid";

const HOUR_MS = 60 * 60 * 1000;
const futureExpiry = (): Date => new Date(Date.now() + HOUR_MS);
const pastExpiry = (): Date => new Date(Date.now() - HOUR_MS);

const seedUser = async (store: AuthMapStore, username: string): Promise<string> => {
  const uuid = generateUuid();
  await store.saveUser({
    uuid,
    username,
    passwordHash: "hash",
    role: "user",
    approved: true,
    banned: false,
  });
  return uuid;
};

describe("AuthMapStore — TTL refresh-токенов (TASK-17)", (): void => {
  it("истёкший refresh-токен не возвращается и удаляется лениво", async (): Promise<void> => {
    const store = new AuthMapStore();
    const uuid = await seedUser(store, "ttluser");
    await store.saveRefresh("ttl-jti", { userId: uuid, username: "ttluser" }, pastExpiry());

    expect(await store.findRefresh("ttl-jti")).toBeUndefined();
    expect(await store.claimRefresh("ttl-jti")).toBeUndefined();
  });

  it("claimRefresh возвращает живую запись и забирает её", async (): Promise<void> => {
    const store = new AuthMapStore();
    const uuid = await seedUser(store, "liveuser");
    await store.saveRefresh("live-jti", { userId: uuid, username: "liveuser" }, futureExpiry());

    expect(await store.claimRefresh("live-jti")).toEqual({
      userId: uuid,
      username: "liveuser",
    });
    expect(await store.findRefresh("live-jti")).toBeUndefined();
  });

  it("сохранение нового токена чистит просроченные записи всех пользователей", async (): Promise<void> => {
    const store = new AuthMapStore();
    const first = await seedUser(store, "expiredfirst");
    const second = await seedUser(store, "expiredsecond");
    await store.saveRefresh(
      "expired-jti",
      { userId: first, username: "expiredfirst" },
      pastExpiry(),
    );

    await store.saveRefresh(
      "fresh-jti",
      { userId: second, username: "expiredsecond" },
      futureExpiry(),
    );

    expect(await store.findRefresh("expired-jti")).toBeUndefined();
    expect(await store.findRefresh("fresh-jti")).toBeDefined();
  });
});

describe("AuthMapStore — лимит refresh-токенов на пользователя (TASK-17)", (): void => {
  it("превышение лимита вытесняет самый старый токен пользователя", async (): Promise<void> => {
    const store = new AuthMapStore();
    const uuid = await seedUser(store, "evictuser");
    const jtis = Array.from({ length: MAX_REFRESH_TOKENS_PER_USER + 1 }, (_, i) => `evict-${i}`);
    for (const [index, jti] of jtis.entries()) {
      await store.saveRefresh(
        jti,
        { userId: uuid, username: "evictuser" },
        new Date(Date.now() + HOUR_MS + index),
      );
    }

    expect(await store.findRefresh(jtis[0]!)).toBeUndefined();
    for (const jti of jtis.slice(1)) {
      expect(await store.findRefresh(jti)).toBeDefined();
    }
  });

  it("лимит не затрагивает токены других пользователей", async (): Promise<void> => {
    const store = new AuthMapStore();
    const first = await seedUser(store, "limuser1");
    const second = await seedUser(store, "limuser2");
    for (let i = 0; i < MAX_REFRESH_TOKENS_PER_USER; i++) {
      await store.saveRefresh(
        `lim1-${i}`,
        { userId: first, username: "limuser1" },
        new Date(Date.now() + HOUR_MS + i),
      );
    }

    await store.saveRefresh("lim1-own", { userId: first, username: "limuser1" }, futureExpiry());
    await store.saveRefresh("lim2-own", { userId: second, username: "limuser2" }, futureExpiry());

    expect(await store.findRefresh("lim1-own")).toBeDefined();
    expect(await store.findRefresh("lim2-own")).toBeDefined();
    expect(await store.findRefresh("lim1-0")).toBeUndefined();
  });
});

describe("AuthMapStore — setApproved/setBanned (TASK-38)", (): void => {
  it("setApproved переключает одобрение в обе стороны", async (): Promise<void> => {
    const store = new AuthMapStore();
    const uuid = await seedUser(store, "approveci");

    await store.setApproved(uuid, false);
    expect((await store.findByUsername("approveci"))?.approved).toBe(false);

    await store.setApproved(uuid, true);
    expect((await store.findByUsername("approveci"))?.approved).toBe(true);
  });

  it("setBanned переключает бан в обе стороны", async (): Promise<void> => {
    const store = new AuthMapStore();
    const uuid = await seedUser(store, "banuser");

    await store.setBanned(uuid, true);
    expect((await store.findByUsername("banuser"))?.banned).toBe(true);

    await store.setBanned(uuid, false);
    expect((await store.findByUsername("banuser"))?.banned).toBe(false);
  });
});
