import { afterAll, beforeAll, expect, it } from "bun:test";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  postgresDescribe,
} from "../../utils/tests/postgres-suite";
import { UserContentPostgresStore } from "../user-content.store";

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

  it("deleteById удаляет и возвращает запись", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgcnt" });
    const skin = await store.save(user.uuid, "skins/delete-me.png", "skin");

    const removed = await store.deleteById(skin.id, "skin");

    expect(removed?.id).toBe(skin.id);
    expect(removed?.filePath).toBe("skins/delete-me.png");
    expect(await store.findById(skin.id, "skin")).toBeUndefined();
    expect(await store.deleteById(skin.id, "skin")).toBeUndefined();
  });
});
