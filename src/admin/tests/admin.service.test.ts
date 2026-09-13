import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it, spyOn } from "bun:test";
import { AdminService } from "../admin.service";
import { AdminMapStore } from "../admin.store";
import { AuthMapStore } from "../../auth/service/auth_store.service";
import { CronService } from "../../cron/cron.service";

const ACTOR = {
  uuid: "rollback-owner-uuid",
  username: "rollbackowner",
  role: "owner",
};

describe("AdminService: атомарность мутаций (TASK-15)", (): void => {
  const seed = async (): Promise<{
    adminStore: AdminMapStore;
    authStore: AuthMapStore;
    service: AdminService;
  }> => {
    const adminStore = new AdminMapStore();
    const authStore = new AuthMapStore();
    const service = new AdminService(adminStore, authStore, new CronService());
    await adminStore.saveUser({
      uuid: "rollback-target-uuid",
      username: "rollbacktarget",
      role: "user",
      approved: true,
      banned: false,
    });
    await authStore.saveUser({
      uuid: "rollback-target-uuid",
      username: "rollbacktarget",
      passwordHash: await Bun.password.hash("rollbackpass"),
      role: "user",
      approved: true,
      banned: false,
    });
    return { adminStore, authStore, service };
  };

  it("setRole синхронизирует роль в обоих сторах", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();

    await service.setRole("rollbacktarget", "admin", ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.role).toBe("admin");
    expect((await authStore.findByUsername("rollbacktarget"))?.role).toBe("admin");
  });

  it("setApproved синхронизирует статус одобрения в обоих сторах (TASK-38)", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();

    await service.setApproved("rollbacktarget", false, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.approved).toBe(false);
    expect((await authStore.findByUsername("rollbacktarget"))?.approved).toBe(false);

    await service.setApproved("rollbacktarget", true, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
    expect((await authStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
  });

  it("setBanned синхронизирует статус бана в обоих сторах (TASK-38)", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();

    await service.setBanned("rollbacktarget", true, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.banned).toBe(true);
    expect((await authStore.findByUsername("rollbacktarget"))?.banned).toBe(true);

    await service.setBanned("rollbacktarget", false, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.banned).toBe(false);
    expect((await authStore.findByUsername("rollbacktarget"))?.banned).toBe(false);
  });

  it("setApproved откатывает admin-стор при сбое auth-стора (TASK-38)", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const setApproved = spyOn(authStore, "setApproved").mockRejectedValue(
      new Error("auth store down"),
    );

    await expect(service.setApproved("rollbacktarget", false, ACTOR)).rejects.toThrow(
      "auth store down",
    );

    expect((await adminStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
    setApproved.mockRestore();
  });

  it("setBanned откатывает admin-стор при сбое auth-стора (TASK-38)", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const setBanned = spyOn(authStore, "setBanned").mockRejectedValue(new Error("auth store down"));

    await expect(service.setBanned("rollbacktarget", true, ACTOR)).rejects.toThrow(
      "auth store down",
    );

    expect((await adminStore.findByUsername("rollbacktarget"))?.banned).toBe(false);
    setBanned.mockRestore();
  });

  it("setRole откатывает роль в admin-сторе при сбое auth-стора", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const updateRole = spyOn(authStore, "updateRole").mockRejectedValue(
      new Error("auth store down"),
    );

    await expect(service.setRole("rollbacktarget", "admin", ACTOR)).rejects.toThrow(
      "auth store down",
    );

    expect((await adminStore.findByUsername("rollbacktarget"))?.role).toBe("user");
    updateRole.mockRestore();
  });

  it("setOwnerRole откатывает роль при сбое auth-стора", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const updateRole = spyOn(authStore, "updateRole").mockRejectedValue(
      new Error("auth store down"),
    );

    await expect(service.setOwnerRole("rollbacktarget", ACTOR)).rejects.toThrow("auth store down");

    expect((await adminStore.findByUsername("rollbacktarget"))?.role).toBe("user");
    updateRole.mockRestore();
  });

  it("setUserPassword меняет пароль и отзывает refresh-токены", async (): Promise<void> => {
    const { authStore, service } = await seed();
    await authStore.saveRefresh(
      "rollback-jti",
      { userId: "rollback-target-uuid", username: "rollbacktarget" },
      new Date(Date.now() + 60 * 60 * 1000),
    );

    await service.setUserPassword("rollbacktarget", "newownerpass", ACTOR);

    const stored = await authStore.findByUsername("rollbacktarget");
    expect(await Bun.password.verify("newownerpass", stored!.passwordHash)).toBe(true);
    expect(await authStore.findRefresh("rollback-jti")).toBeUndefined();
  });

  it("deleteUser откатывает удаление в admin-сторе при сбое auth-стора", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const deleteUser = spyOn(authStore, "deleteUser").mockRejectedValue(
      new Error("auth store down"),
    );

    await expect(service.deleteUser("rollbacktarget", ACTOR)).rejects.toThrow("auth store down");

    expect(await adminStore.findByUsername("rollbacktarget")).toBeDefined();
    deleteUser.mockRestore();
  });

  it("restoreUser откатывает восстановление при сбое auth-стора", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    await service.deleteUser("rollbacktarget", ACTOR);
    const restoreUser = spyOn(authStore, "restoreUser").mockRejectedValue(
      new Error("auth store down"),
    );

    await expect(service.restoreUser("rollbacktarget", ACTOR)).rejects.toThrow("auth store down");

    expect(await adminStore.findByUsername("rollbacktarget")).toBeUndefined();
    expect(await adminStore.findDeletedByUsername("rollbacktarget")).toBeDefined();
    restoreUser.mockRestore();
  });
});
