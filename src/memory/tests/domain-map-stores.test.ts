import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { MemoryDb } from "../memory-db";
import { AuthMapStore } from "../../auth/service/auth_store";
import { AdminMapStore } from "../../admin/admin_store";
import { YggdrasilMapStore } from "../../yggdrasil/service/yggdrasil_store";

describe("map-режим: общий MemoryDb связывает доменные сторы (TASK-269.20)", (): void => {
  const USERNAME = "mapjourney";
  const UUID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const makeStores = (): {
    authStore: AuthMapStore;
    adminStore: AdminMapStore;
    yggStore: YggdrasilMapStore;
  } => {
    const db = new MemoryDb();
    return {
      authStore: new AuthMapStore(db),
      adminStore: new AdminMapStore(db),
      yggStore: new YggdrasilMapStore(db),
    };
  };

  const registerUser = async (authStore: AuthMapStore): Promise<void> => {
    const saved = await authStore.saveUser({
      uuid: UUID,
      username: USERNAME,
      passwordHash: await Bun.password.hash("map-journey-pass"),
      role: "user",
      approved: false,
      banned: false,
    });
    if (!saved) throw new Error("регистрация не удалась");
  };

  it("регистрация видна панели и Yggdrasil-протоколу, approve открывает authenticate", async (): Promise<void> => {
    const { authStore, adminStore, yggStore } = makeStores();
    await registerUser(authStore);

    const page = await adminStore.searchUsers({ limit: 100, offset: 0, username: USERNAME });
    expect(page.items.map((item) => item.username)).toContain(USERNAME);

    expect(await yggStore.findUserByUsername(USERNAME)).toBeDefined();
    expect(await yggStore.findProfilesByUserId(UUID)).toHaveLength(1);

    await expect(yggStore.findUserByUsername("missing")).resolves.toBeUndefined();
  });

  it("approve/ban через админку виден auth- и Yggdrasil-стору без отдельной пропагации", async (): Promise<void> => {
    const { authStore, adminStore, yggStore } = makeStores();
    await registerUser(authStore);

    await adminStore.setApproved(USERNAME, true);

    expect((await authStore.findByUsername(USERNAME))?.approved).toBe(true);
    expect((await yggStore.findUserByUsername(USERNAME))?.approved).toBe(true);

    await adminStore.setBanned(USERNAME, true);

    expect((await authStore.findByUsername(USERNAME))?.banned).toBe(true);
    expect((await yggStore.findUserByUsername(USERNAME))?.banned).toBe(true);
  });

  it("delete прячет пользователя и профиль из Yggdrasil, restore возвращает", async (): Promise<void> => {
    const { authStore, adminStore, yggStore } = makeStores();
    await registerUser(authStore);

    await adminStore.deleteUser(USERNAME);

    expect(await yggStore.findUserByUsername(USERNAME)).toBeUndefined();
    expect(await yggStore.findProfilesByUserId(UUID)).toEqual([]);
    expect(await yggStore.findProfileByUuid(UUID)).toBeUndefined();

    await adminStore.restoreUser(USERNAME);

    expect(await yggStore.findUserByUsername(USERNAME)).toBeDefined();
    expect(await yggStore.findProfileByUuid(UUID)).toBeDefined();
  });
});
