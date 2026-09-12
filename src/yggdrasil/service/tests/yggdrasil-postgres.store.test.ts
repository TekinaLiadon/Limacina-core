import { afterAll, beforeAll, expect, it } from "bun:test";
import {
  cleanupTrackedUsers,
  createPostgresUser,
  ensurePostgresSchema,
  postgresDescribe,
} from "../../../utils/tests/postgres-suite";
import { YggdrasilPostgresStore } from "../yggdrasil_postgres";

const store = new YggdrasilPostgresStore();

postgresDescribe("YggdrasilPostgresStore (postgres)", () => {
  beforeAll(async () => {
    await ensurePostgresSchema();
  });

  afterAll(async () => {
    await cleanupTrackedUsers();
  });

  it("находит профиль по uuid и username вместе с текстурами", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgygg" });
    await store.saveProfile({
      uuid: user.uuid,
      userId: user.uuid,
      username: user.username,
      skinUrl: "http://localhost:3005/textures/skin.png",
      skinModel: "slim",
      capeUrl: "http://localhost:3005/capes/cape.png",
    });

    const byUuid = await store.findProfileByUuid(user.uuid);
    expect(byUuid?.username).toBe(user.username);
    expect(byUuid?.userId).toBe(user.uuid);
    expect(byUuid?.skinUrl).toBe("http://localhost:3005/textures/skin.png");
    expect(byUuid?.skinModel).toBe("slim");
    expect(byUuid?.capeUrl).toBe("http://localhost:3005/capes/cape.png");

    const byUsername = await store.findProfileByUsername(user.username);
    expect(byUsername?.uuid).toBe(user.uuid);
    expect(byUsername?.userId).toBe(user.uuid);
  });

  it("профиль пользователя без текстур отдаёт null-поля", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgygg" });

    const profile = await store.findProfileByUuid(user.uuid);

    expect(profile?.username).toBe(user.username);
    expect(profile?.skinUrl).toBeNull();
    expect(profile?.skinModel).toBeNull();
    expect(profile?.capeUrl).toBeNull();
  });

  it("не находит отсутствующие профили", async () => {
    expect(await store.findProfileByUuid("missing-uuid")).toBeUndefined();
    expect(await store.findProfileByUsername("pgygg_missing")).toBeUndefined();
    expect(await store.findProfilesByUserId("missing-uuid")).toEqual([]);
  });

  it("findProfilesByUsernames возвращает только существующие профили", async () => {
    const first = await createPostgresUser({ usernamePrefix: "pgygg" });
    const second = await createPostgresUser({ usernamePrefix: "pgygg" });

    const profiles = await store.findProfilesByUsernames([
      first.username,
      second.username,
      "pgygg_missing",
    ]);

    expect(profiles.map((profile) => profile.username).sort()).toEqual(
      [first.username, second.username].sort(),
    );
    expect(await store.findProfilesByUsernames([])).toEqual([]);
  });

  it("updateProfileTexture создаёт запись и частично обновляет", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgygg" });

    await store.updateProfileTexture(user.uuid, {
      skinUrl: "http://localhost:3005/textures/new.png",
      skinModel: "classic",
    });

    const created = await store.findProfileByUuid(user.uuid);
    expect(created?.skinUrl).toBe("http://localhost:3005/textures/new.png");
    expect(created?.skinModel).toBe("classic");
    expect(created?.capeUrl).toBeNull();

    await store.updateProfileTexture(user.uuid, {
      capeUrl: "http://localhost:3005/capes/new.png",
    });

    const updated = await store.findProfileByUuid(user.uuid);
    expect(updated?.skinUrl).toBe("http://localhost:3005/textures/new.png");
    expect(updated?.skinModel).toBe("classic");
    expect(updated?.capeUrl).toBe("http://localhost:3005/capes/new.png");

    await store.updateProfileTexture(user.uuid, {});

    const untouched = await store.findProfileByUuid(user.uuid);
    expect(untouched?.skinUrl).toBe("http://localhost:3005/textures/new.png");
    expect(untouched?.capeUrl).toBe("http://localhost:3005/capes/new.png");
  });

  it("countProfilesByTextureUrl считает профили по skin_url и cape_url", async () => {
    const first = await createPostgresUser({ usernamePrefix: "pgygg" });
    const second = await createPostgresUser({ usernamePrefix: "pgygg" });
    await store.updateProfileTexture(first.uuid, {
      skinUrl: "http://localhost:3005/textures/shared.png",
    });
    await store.updateProfileTexture(second.uuid, {
      capeUrl: "http://localhost:3005/textures/shared.png",
    });
    await store.updateProfileTexture(first.uuid, {
      capeUrl: "http://localhost:3005/capes/own.png",
    });

    expect(await store.countProfilesByTextureUrl("http://localhost:3005/textures/shared.png")).toBe(
      2,
    );
    expect(await store.countProfilesByTextureUrl("http://localhost:3005/capes/own.png")).toBe(1);
    expect(
      await store.countProfilesByTextureUrl("http://localhost:3005/textures/missing.png"),
    ).toBe(0);
  });

  it("findUserByUsername отдаёт uuid, хеш пароля и статус banned/approved", async () => {
    const user = await createPostgresUser({ usernamePrefix: "pgygg", approved: true });
    const bannedUser = await createPostgresUser({
      usernamePrefix: "pgygg",
      banned: true,
      approved: true,
    });
    const pendingUser = await createPostgresUser({
      usernamePrefix: "pgygg",
      banned: false,
      approved: false,
    });

    const found = await store.findUserByUsername(user.username);
    expect(found?.uuid).toBe(user.uuid);
    expect(found?.passwordHash).toBe(user.passwordHash);
    expect(found?.banned).toBe(false);
    expect(found?.approved).toBe(true);

    const foundBanned = await store.findUserByUsername(bannedUser.username);
    expect(foundBanned?.banned).toBe(true);
    expect(foundBanned?.approved).toBe(true);

    const foundPending = await store.findUserByUsername(pendingUser.username);
    expect(foundPending?.banned).toBe(false);
    expect(foundPending?.approved).toBe(false);

    expect(await store.findUserByUsername("pgygg_missing")).toBeUndefined();
  });
});
