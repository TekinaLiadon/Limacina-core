import { afterAll, beforeAll, expect, it } from "bun:test";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  postgresDescribe,
} from "../../utils/tests/postgres-suite";
import { UserContentPostgresStore, isUserContentLimitExceededError } from "../user-content.store";

const store = new UserContentPostgresStore();

postgresDescribe("UserContentPostgresStore (postgres)", () => {
  beforeAll(async () => {
    await ensurePostgresSchema();
  });

  afterAll(async () => {
    await cleanupTrackedUsers();
  });

  it("save создаёт скин с моделью и неактивным флагом", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });

    const skin = await store.save(user.uuid, "skins/test-slim.png", "skin", "slim");

    expect(skin.id).toBeGreaterThan(0);
    expect(skin.userUuid).toBe(user.uuid);
    expect(skin.filePath).toBe("skins/test-slim.png");
    expect(skin.skinModel).toBe("slim");
    expect(skin.active).toBe(false);
  });

  it("разделяет типы контента по таблицам", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const skin = await store.save(user.uuid, "skins/one.png", "skin");
    const cape = await store.save(user.uuid, "capes/one.png", "cape");
    const model = await store.save(user.uuid, "models/one.txt", "model");

    const skins = await store.findByUserUuid(user.uuid, "skin");
    const capes = await store.findByUserUuid(user.uuid, "cape");
    const models = await store.findByUserUuid(user.uuid, "model");

    expect(skins.map((item) => item.id)).toEqual([skin.id]);
    expect(capes.map((item) => item.id)).toEqual([cape.id]);
    expect(models.map((item) => item.id)).toEqual([model.id]);
    expect(await store.countByUserUuid(user.uuid, "skin")).toBe(1);
    expect(await store.countByUserUuid(user.uuid, "cape")).toBe(1);
    expect(await store.countByUserUuid(user.uuid, "model")).toBe(1);
  });

  it("findById находит запись в своей таблице", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const skin = await store.save(user.uuid, "skins/find-me.png", "skin");
    const cape = await store.save(user.uuid, "capes/find-me.png", "cape");

    const skinRow = await store.findById(skin.id, "skin");
    expect(skinRow?.filePath).toBe("skins/find-me.png");
    expect(skinRow?.userUuid).toBe(user.uuid);

    const capeRow = await store.findById(cape.id, "cape");
    expect(capeRow?.filePath).toBe("capes/find-me.png");

    expect(await store.findById(999_999_999, "skin")).toBeUndefined();
    expect(await store.findById(999_999_999, "cape")).toBeUndefined();
  });

  it("updateActiveSkin переключает активный скин и не трогает чужие", async () => {
    const first = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const second = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const firstSkin = await store.save(first.uuid, "skins/first.png", "skin");
    const secondSkin = await store.save(first.uuid, "skins/second.png", "skin");
    const foreignSkin = await store.save(second.uuid, "skins/foreign.png", "skin");

    await store.updateActiveSkin(first.uuid, secondSkin.id);

    const skins = await store.findByUserUuid(first.uuid, "skin");
    const activeById = new Map(skins.map((item) => [item.id, item.active]));
    expect(activeById.get(firstSkin.id)).toBe(false);
    expect(activeById.get(secondSkin.id)).toBe(true);
    const foreign = await store.findByUserUuid(second.uuid, "skin");
    expect(foreign.map((item) => item.id)).toEqual([foreignSkin.id]);
    expect(foreign.map((item) => item.active)).toEqual([false]);
  });

  it("deleteByIdAndCountRemaining удаляет запись и считает оставшиеся ссылки на файл", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const first = await store.save(user.uuid, "skins/shared-path.png", "skin");
    const second = await store.save(user.uuid, "skins/shared-path.png", "skin");
    const unique = await store.save(user.uuid, "skins/unique-path.png", "skin");

    const removedShared = await store.deleteByIdAndCountRemaining(first.id, "skin");
    expect(removedShared?.item.id).toBe(first.id);
    expect(removedShared?.item.filePath).toBe("skins/shared-path.png");
    expect(removedShared?.remainingCount).toBe(1);

    const removedLast = await store.deleteByIdAndCountRemaining(second.id, "skin");
    expect(removedLast?.remainingCount).toBe(0);

    const removedUnique = await store.deleteByIdAndCountRemaining(unique.id, "skin");
    expect(removedUnique?.remainingCount).toBe(0);

    expect(await store.findById(first.id, "skin")).toBeUndefined();
  });

  it("deleteByIdAndCountRemaining видит чужие ссылки на общий легаси-путь", async () => {
    const first = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const second = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const ownSkin = await store.save(first.uuid, "skins/legacy-common.png", "skin");
    await store.save(second.uuid, "skins/legacy-common.png", "skin");

    const removed = await store.deleteByIdAndCountRemaining(ownSkin.id, "skin");

    expect(removed?.remainingCount).toBe(1);
  });

  it("deleteByIdAndCountRemaining неизвестного id возвращает undefined", async () => {
    expect(await store.deleteByIdAndCountRemaining(999_999_999, "skin")).toBeUndefined();
  });

  it("countByFilePath считает строки с тем же путём в таблице типа", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });
    await store.save(user.uuid, "skins/count-a.png", "skin");
    await store.save(user.uuid, "skins/count-a.png", "skin");
    await store.save(user.uuid, "capes/count-a.png", "cape");

    expect(await store.countByFilePath("skins/count-a.png", "skin")).toBe(2);
    expect(await store.countByFilePath("capes/count-a.png", "cape")).toBe(1);
    expect(await store.countByFilePath("skins/missing.png", "skin")).toBe(0);
  });

  it("saveWithinLimit вставляет запись под лимитом и отклоняет сверх лимита", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });
    await store.saveWithinLimit(user.uuid, "capes/lim-1.png", "cape", 2);

    const second = await store.saveWithinLimit(user.uuid, "capes/lim-2.png", "cape", 2);
    expect(second.filePath).toBe("capes/lim-2.png");
    expect(second.id).toBeGreaterThan(0);
    expect(await store.countByUserUuid(user.uuid, "cape")).toBe(2);

    const skin = await store.saveWithinLimit(user.uuid, "skins/lim-skin.png", "skin", 2, "slim");
    expect(skin.skinModel).toBe("slim");
    expect(skin.active).toBe(false);

    const exceedCape = await store.saveWithinLimit(user.uuid, "capes/lim-3.png", "cape", 2).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isUserContentLimitExceededError(exceedCape)).toBe(true);

    const exceedSkin = await store.saveWithinLimit(user.uuid, "skins/lim-2.png", "skin", 1).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isUserContentLimitExceededError(exceedSkin)).toBe(true);

    expect(await store.countByUserUuid(user.uuid, "cape")).toBe(2);
    expect(await store.countByUserUuid(user.uuid, "skin")).toBe(1);
  });

  it("saveWithinLimit отклоняет параллельные вставки сверх лимита", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        store.saveWithinLimit(user.uuid, `capes/rl-${i}.png`, "cape", 2),
      ),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(3);
    expect(
      rejected.every(
        (result) => result.status === "rejected" && isUserContentLimitExceededError(result.reason),
      ),
    ).toBe(true);
  });
});
