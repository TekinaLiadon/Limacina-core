import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { YggdrasilMapStore } from "../yggdrasil_store";
import type { IYggdrasilStore, YggdrasilProfile, YggdrasilSeedUser } from "../yggdrasil_store";
import { YggdrasilPostgresStore } from "../yggdrasil_postgres";
import { generateUuid } from "../../../utils/uuid";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
} from "../../../utils/tests/postgres-suite";
import { contractDescribeEach } from "../../../utils/tests/driver-contract";

interface YggdrasilDriverContext {
  store: IYggdrasilStore;
  makeUsers: (specs?: Partial<YggdrasilSeedUser>[]) => Promise<YggdrasilSeedUser[]>;
}

const mapContext = (): YggdrasilDriverContext => {
  let store: IYggdrasilStore | undefined;
  const seeds: YggdrasilSeedUser[] = [];
  const makeUsers = async (
    specs: Partial<YggdrasilSeedUser>[] = [],
  ): Promise<YggdrasilSeedUser[]> => {
    for (const spec of specs) {
      seeds.push({
        username: `mapy_${generateUuid().slice(0, 12)}`,
        uuid: generateUuid(),
        passwordHash: "hash",
        approved: true,
        ...spec,
      });
    }
    store = new YggdrasilMapStore({ users: seeds });
    return seeds;
  };
  return {
    get store(): IYggdrasilStore {
      if (!store) throw new Error("makeUsers должен быть вызван до обращения к стору");
      return store;
    },
    makeUsers,
  };
};

const postgresContext = (): YggdrasilDriverContext => {
  const store = new YggdrasilPostgresStore();
  const makeUsers = async (
    specs: Partial<YggdrasilSeedUser>[] = [],
  ): Promise<YggdrasilSeedUser[]> => {
    const users: YggdrasilSeedUser[] = [];
    for (const spec of specs) {
      const created = await createPostgresUser({ usernamePrefix: "pgyct", ...spec });
      users.push({
        username: created.username,
        uuid: created.uuid,
        passwordHash: created.passwordHash,
        banned: created.banned,
        approved: created.approved,
      });
    }
    return users;
  };
  return { store, makeUsers };
};

const profileOf = (user: YggdrasilSeedUser): YggdrasilProfile => ({
  uuid: user.uuid,
  userId: user.uuid,
  username: user.username,
});

const saveProfile = async (store: IYggdrasilStore, user: YggdrasilSeedUser): Promise<void> => {
  await store.saveProfile(profileOf(user));
};

afterAll(cleanupTrackedUsers);

contractDescribeEach("контракт IYggdrasilStore", (driver) => {
  let ctx: YggdrasilDriverContext;

  beforeEach(() => {
    ctx = driver.driver === "map" ? mapContext() : postgresContext();
  });

  if (driver.driver === "postgres") {
    beforeAll(ensurePostgresSchema);
  }

  it("saveProfile сохраняет профиль с текстурами и находится по uuid/username/userId", async () => {
    const [user] = await ctx.makeUsers([{}]);
    await ctx.store.saveProfile({
      uuid: user!.uuid,
      userId: user!.uuid,
      username: user!.username,
      skinUrl: "http://localhost:3005/textures/skin.png",
      skinModel: "slim",
      capeUrl: "http://localhost:3005/capes/cape.png",
    });

    const byUuid = await ctx.store.findProfileByUuid(user!.uuid);
    expect(byUuid?.username).toBe(user!.username);
    expect(byUuid?.userId).toBe(user!.uuid);
    expect(byUuid?.skinUrl).toBe("http://localhost:3005/textures/skin.png");
    expect(byUuid?.skinModel).toBe("slim");
    expect(byUuid?.capeUrl).toBe("http://localhost:3005/capes/cape.png");

    const byUsername = await ctx.store.findProfileByUsername(user!.username);
    expect(byUsername?.uuid).toBe(user!.uuid);
  });

  it("профиль пользователя без текстур отдаёт пустые поля", async () => {
    const [user] = await ctx.makeUsers([{}]);
    await saveProfile(ctx.store, user!);

    const profile = await ctx.store.findProfileByUuid(user!.uuid);

    expect(profile?.skinUrl ?? null).toBeNull();
    expect(profile?.skinModel ?? null).toBeNull();
    expect(profile?.capeUrl ?? null).toBeNull();
  });

  it("findProfilesByUsernames возвращает только существующие профили", async () => {
    const [first, second] = await ctx.makeUsers([{}, {}]);
    await saveProfile(ctx.store, first!);
    await saveProfile(ctx.store, second!);

    const profiles = await ctx.store.findProfilesByUsernames([
      first!.username,
      second!.username,
      `missing_${generateUuid().slice(0, 12)}`,
    ]);

    expect(profiles.map((profile) => profile.username).sort()).toEqual(
      [first!.username, second!.username].sort(),
    );
    expect(await ctx.store.findProfilesByUsernames([])).toEqual([]);
  });

  it("updateProfileTexture частично обновляет текстуры существующего профиля", async () => {
    const [user] = await ctx.makeUsers([{}]);
    await saveProfile(ctx.store, user!);

    await ctx.store.updateProfileTexture(user!.uuid, {
      skinUrl: "http://localhost:3005/textures/new.png",
      skinModel: "classic",
    });

    const created = await ctx.store.findProfileByUuid(user!.uuid);
    expect(created?.skinUrl).toBe("http://localhost:3005/textures/new.png");
    expect(created?.skinModel).toBe("classic");
    expect(created?.capeUrl ?? null).toBeNull();

    await ctx.store.updateProfileTexture(user!.uuid, {
      capeUrl: "http://localhost:3005/capes/new.png",
    });

    const updated = await ctx.store.findProfileByUuid(user!.uuid);
    expect(updated?.skinUrl).toBe("http://localhost:3005/textures/new.png");
    expect(updated?.skinModel).toBe("classic");
    expect(updated?.capeUrl).toBe("http://localhost:3005/capes/new.png");

    await ctx.store.updateProfileTexture(user!.uuid, {});

    const untouched = await ctx.store.findProfileByUuid(user!.uuid);
    expect(untouched?.skinUrl).toBe("http://localhost:3005/textures/new.png");
    expect(untouched?.capeUrl).toBe("http://localhost:3005/capes/new.png");
  });

  it("countProfilesByTextureUrl считает профили по skin_url и cape_url", async () => {
    const [first, second] = await ctx.makeUsers([{}, {}]);
    await saveProfile(ctx.store, first!);
    await saveProfile(ctx.store, second!);

    await ctx.store.updateProfileTexture(first!.uuid, {
      skinUrl: "http://localhost:3005/textures/shared.png",
    });
    await ctx.store.updateProfileTexture(second!.uuid, {
      capeUrl: "http://localhost:3005/textures/shared.png",
    });
    await ctx.store.updateProfileTexture(first!.uuid, {
      capeUrl: "http://localhost:3005/capes/own.png",
    });

    expect(
      await ctx.store.countProfilesByTextureUrl("http://localhost:3005/textures/shared.png"),
    ).toBe(2);
    expect(await ctx.store.countProfilesByTextureUrl("http://localhost:3005/capes/own.png")).toBe(
      1,
    );
    expect(
      await ctx.store.countProfilesByTextureUrl("http://localhost:3005/textures/missing.png"),
    ).toBe(0);
  });

  it("findUserByUsername отдаёт креды со статусом banned/approved", async () => {
    const [active, banned, pending] = await ctx.makeUsers([
      { approved: true },
      { banned: true, approved: true },
      { banned: false, approved: false },
    ]);

    const found = await ctx.store.findUserByUsername(active!.username);
    expect(found?.uuid).toBe(active!.uuid);
    expect(found?.passwordHash).toBe(active!.passwordHash);
    expect(found?.banned).toBe(false);
    expect(found?.approved).toBe(true);

    expect((await ctx.store.findUserByUsername(banned!.username))?.banned).toBe(true);
    expect((await ctx.store.findUserByUsername(pending!.username))?.approved).toBe(false);
    expect(
      await ctx.store.findUserByUsername(`missing_${generateUuid().slice(0, 12)}`),
    ).toBeUndefined();
  });
});
