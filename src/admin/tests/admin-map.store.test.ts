import { describe, expect, it } from "bun:test";
import { AdminMapStore } from "../admin_store";
import { AuthMapStore } from "../../auth/service/auth_store";
import { MemoryDb } from "../../memory/memory-db";

const buildUser = (username: string, overrides: Record<string, unknown> = {}) => ({
  uuid: `uuid-${username}`,
  username,
  role: "user",
  approved: true,
  banned: false,
  ...overrides,
});

describe("AdminMapStore — порядок пагинации", (): void => {
  it("searchUsers сортирует по lower(username), tie-break по точному нику", async (): Promise<void> => {
    const store = new AdminMapStore();
    const names = ["BBBuser", "aaAuser", "Aabuser", "ZZuser"];
    for (const username of names) {
      await store.saveUser(buildUser(username));
    }

    const page = await store.searchUsers({ limit: 10, offset: 0 });

    expect(page.items.map((item) => item.username)).toEqual([
      "aaAuser",
      "Aabuser",
      "BBBuser",
      "ZZuser",
    ]);
  });

  it("searchDeletedUsers сортирует по lower(username), tie-break по точному нику", async (): Promise<void> => {
    const store = new AdminMapStore();
    const names = ["BBBuser", "aaAuser", "Aabuser"];
    for (const username of names) {
      await store.saveUser(buildUser(username));
      await store.deleteUser(username);
    }

    const page = await store.searchDeletedUsers({ limit: 10, offset: 0 });

    expect(page.items.map((item) => item.username)).toEqual(["aaAuser", "Aabuser", "BBBuser"]);
  });
});

describe("AdminMapStore — телеметрия установок", (): void => {
  const currentId = "v1-22222222222222222222222222222222";
  const historyId = "v1-11111111111111111111111111111111";

  const makeStores = (): { store: AdminMapStore; authStore: AuthMapStore } => {
    const db = new MemoryDb();
    return { store: new AdminMapStore(db), authStore: new AuthMapStore(db) };
  };

  it("searchUsers отдаёт текущий install ID и историю", async (): Promise<void> => {
    const { store, authStore } = makeStores();
    await store.saveUser(buildUser("telemetryuser"));
    await authStore.recordInstallId("uuid-telemetryuser", historyId);
    await authStore.recordInstallId("uuid-telemetryuser", currentId);

    const page = await store.searchUsers({ limit: 10, offset: 0, username: "telemetry" });

    expect(page.items[0]?.installIds).toEqual([currentId, historyId]);
  });

  it("searchUsers отдаёт пустой массив без телеметрии", async (): Promise<void> => {
    const { store } = makeStores();
    await store.saveUser(buildUser("plainuser"));

    const page = await store.searchUsers({ limit: 10, offset: 0, username: "plain" });

    expect(page.items[0]?.installIds).toEqual([]);
  });

  it("searchUsers фильтрует по текущему и историческому ID без учёта регистра", async (): Promise<void> => {
    const { store, authStore } = makeStores();
    await store.saveUser(buildUser("currentuser"));
    await store.saveUser(buildUser("historyuser"));
    await authStore.recordInstallId("uuid-currentuser", currentId);
    await authStore.recordInstallId("uuid-historyuser", historyId);

    const byCurrent = await store.searchUsers({ limit: 10, offset: 0, installId: "2222" });
    expect(byCurrent.items.map((item) => item.username)).toEqual(["currentuser"]);

    const byHistory = await store.searchUsers({ limit: 10, offset: 0, installId: "V1-1111" });
    expect(byHistory.items.map((item) => item.username)).toEqual(["historyuser"]);

    const missing = await store.searchUsers({ limit: 10, offset: 0, installId: "ffff" });
    expect(missing.items).toEqual([]);
    expect(missing.total).toBe(0);
  });

  it("searchUsers не дублирует ID, если установка вернулась к прежнему ID", async (): Promise<void> => {
    const { store, authStore } = makeStores();
    await store.saveUser(buildUser("repeatuser"));
    await authStore.recordInstallId("uuid-repeatuser", historyId);
    await authStore.recordInstallId("uuid-repeatuser", currentId);
    await authStore.recordInstallId("uuid-repeatuser", historyId);

    const page = await store.searchUsers({ limit: 10, offset: 0, username: "repeat" });

    expect(page.items[0]?.installIds).toEqual([historyId, currentId]);
  });
});

describe("AdminMapStore — вычистка старых удалённых", (): void => {
  it("purgeOldDeletedUsers удаляет удалённые записи старше retention", async (): Promise<void> => {
    const store = new AdminMapStore();
    await store.saveUser(buildUser("purgeuser"));
    await store.deleteUser("purgeuser");
    await Bun.sleep(2);

    const purged = await store.purgeOldDeletedUsers(0);

    expect(purged).toBe(1);
    expect(await store.findDeletedByUsername("purgeuser")).toBeUndefined();
  });

  it("purgeOldDeletedUsers не трогает живых пользователей", async (): Promise<void> => {
    const store = new AdminMapStore();
    await store.saveUser(buildUser("liveuser"));
    await Bun.sleep(2);

    const purged = await store.purgeOldDeletedUsers(0);

    expect(purged).toBe(0);
    expect(await store.findByUsername("liveuser")).toBeDefined();
  });
});
