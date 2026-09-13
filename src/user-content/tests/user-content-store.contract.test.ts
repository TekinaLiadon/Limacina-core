import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import {
  UserContentMapStore,
  UserContentPostgresStore,
  isUserContentLimitExceededError,
} from "../user-content.store";
import type { IUserContentStore } from "../user-content.store";
import { generateUuid } from "../../utils/uuid";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
} from "../../utils/tests/postgres-suite";
import { contractDescribeEach } from "../../utils/tests/driver-contract";

interface ContentDriverContext {
  store: IUserContentStore;
  makeUser: () => Promise<{ uuid: string }>;
}

const mapContext = (): ContentDriverContext => {
  const store = new UserContentMapStore();
  const makeUser = async (): Promise<{ uuid: string }> => ({ uuid: generateUuid() });
  return { store, makeUser };
};

const postgresContext = (): ContentDriverContext => {
  const store = new UserContentPostgresStore();
  const makeUser = async (): Promise<{ uuid: string }> => {
    const user = await createPostgresUser({ usernamePrefix: "pgcct" });
    return { uuid: user.uuid };
  };
  return { store, makeUser };
};

afterAll(cleanupTrackedUsers);

contractDescribeEach("контракт IUserContentStore", (driver) => {
  let ctx: ContentDriverContext;

  beforeEach(() => {
    ctx = driver.driver === "map" ? mapContext() : postgresContext();
  });

  if (driver.driver === "postgres") {
    beforeAll(ensurePostgresSchema);
  }

  it("save создаёт скин с моделью и неактивным флагом", async () => {
    const user = await ctx.makeUser();

    const skin = await ctx.store.save(user.uuid, "skins/ct-slim.png", "skin", "slim");

    expect(skin.id).toBeGreaterThan(0);
    expect(skin.userUuid).toBe(user.uuid);
    expect(skin.filePath).toBe("skins/ct-slim.png");
    expect(skin.skinModel).toBe("slim");
    expect(skin.active).toBe(false);

    const plain = await ctx.store.save(user.uuid, "skins/ct-plain.png", "skin");
    expect(plain.skinModel).toBeNull();
  });

  it("типы контента разделяются по таблицам", async () => {
    const user = await ctx.makeUser();
    const skin = await ctx.store.save(user.uuid, "skins/one.png", "skin");
    const cape = await ctx.store.save(user.uuid, "capes/one.png", "cape");
    const model = await ctx.store.save(user.uuid, "models/one.txt", "model");

    const skins = await ctx.store.findByUserUuid(user.uuid, "skin");
    const capes = await ctx.store.findByUserUuid(user.uuid, "cape");
    const models = await ctx.store.findByUserUuid(user.uuid, "model");

    expect(skins.map((item) => item.id)).toEqual([skin.id]);
    expect(capes.map((item) => item.id)).toEqual([cape.id]);
    expect(models.map((item) => item.id)).toEqual([model.id]);
    expect(await ctx.store.countByUserUuid(user.uuid, "skin")).toBe(1);
    expect(await ctx.store.countByUserUuid(user.uuid, "cape")).toBe(1);
    expect(await ctx.store.countByUserUuid(user.uuid, "model")).toBe(1);
  });

  it("findById находит запись своего типа, неизвестный id — undefined", async () => {
    const user = await ctx.makeUser();
    const skin = await ctx.store.save(user.uuid, "skins/find-me.png", "skin");
    const cape = await ctx.store.save(user.uuid, "capes/find-me.png", "cape");

    const skinRow = await ctx.store.findById(skin.id, "skin");
    expect(skinRow?.filePath).toBe("skins/find-me.png");
    expect(skinRow?.userUuid).toBe(user.uuid);
    expect((await ctx.store.findById(cape.id, "cape"))?.filePath).toBe("capes/find-me.png");

    expect(await ctx.store.findById(999_999_999, "skin")).toBeUndefined();
    expect(await ctx.store.findById(999_999_999, "cape")).toBeUndefined();
  });

  it("countByFilePath считает пути в своей таблице типов", async () => {
    const user = await ctx.makeUser();
    await ctx.store.save(user.uuid, "skins/count-a.png", "skin");
    await ctx.store.save(user.uuid, "skins/count-a.png", "skin");
    await ctx.store.save(user.uuid, "capes/count-a.png", "cape");

    expect(await ctx.store.countByFilePath("skins/count-a.png", "skin")).toBe(2);
    expect(await ctx.store.countByFilePath("capes/count-a.png", "cape")).toBe(1);
    expect(await ctx.store.countByFilePath("skins/missing.png", "skin")).toBe(0);
  });

  it("saveWithinLimit вставляет под лимитом и отклоняет сверх лимита", async () => {
    const user = await ctx.makeUser();

    await ctx.store.saveWithinLimit(user.uuid, "capes/lim-1.png", "cape", 2);
    const second = await ctx.store.saveWithinLimit(user.uuid, "capes/lim-2.png", "cape", 2);
    expect(second.id).toBeGreaterThan(0);
    expect(await ctx.store.countByUserUuid(user.uuid, "cape")).toBe(2);

    const exceed = await ctx.store.saveWithinLimit(user.uuid, "capes/lim-3.png", "cape", 2).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isUserContentLimitExceededError(exceed)).toBe(true);
    expect(await ctx.store.countByUserUuid(user.uuid, "cape")).toBe(2);

    const skin = await ctx.store.saveWithinLimit(
      user.uuid,
      "skins/lim-skin.png",
      "skin",
      2,
      "slim",
    );
    expect(skin.skinModel).toBe("slim");
    expect(skin.active).toBe(false);
  });

  it("deleteByIdAndCountRemaining удаляет запись и считает оставшиеся ссылки на файл", async () => {
    const first = await ctx.makeUser();
    const second = await ctx.makeUser();
    const ownFirst = await ctx.store.save(first.uuid, "skins/shared-path.png", "skin");
    const ownSecond = await ctx.store.save(first.uuid, "skins/shared-path.png", "skin");
    const foreign = await ctx.store.save(second.uuid, "skins/shared-path.png", "skin");

    const removedShared = await ctx.store.deleteByIdAndCountRemaining(ownFirst.id, "skin");
    expect(removedShared?.item.id).toBe(ownFirst.id);
    expect(removedShared?.remainingCount).toBe(2);

    const removedSecond = await ctx.store.deleteByIdAndCountRemaining(ownSecond.id, "skin");
    expect(removedSecond?.remainingCount).toBe(1);

    const removedForeign = await ctx.store.deleteByIdAndCountRemaining(foreign.id, "skin");
    expect(removedForeign?.remainingCount).toBe(0);

    expect(await ctx.store.findById(ownFirst.id, "skin")).toBeUndefined();
    expect(await ctx.store.deleteByIdAndCountRemaining(ownFirst.id, "skin")).toBeUndefined();
  });

  it("updateActiveSkin переключает активный скин и не трогает чужие", async () => {
    const first = await ctx.makeUser();
    const second = await ctx.makeUser();
    const firstSkin = await ctx.store.save(first.uuid, "skins/first.png", "skin");
    const secondSkin = await ctx.store.save(first.uuid, "skins/second.png", "skin");
    const foreignSkin = await ctx.store.save(second.uuid, "skins/foreign.png", "skin");

    await ctx.store.updateActiveSkin(first.uuid, secondSkin.id);

    const skins = await ctx.store.findByUserUuid(first.uuid, "skin");
    const activeById = new Map(skins.map((item) => [item.id, item.active]));
    expect(activeById.get(firstSkin.id)).toBe(false);
    expect(activeById.get(secondSkin.id)).toBe(true);

    const foreign = await ctx.store.findByUserUuid(second.uuid, "skin");
    expect(foreign.map((item) => item.active)).toEqual([false]);

    expect(foreignSkin.id).toBeGreaterThan(0);
  });
});
