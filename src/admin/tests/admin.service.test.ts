import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it, spyOn } from "bun:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { AdminService } from "../admin.service";
import { AdminMapStore } from "../admin_store";
import { AuthMapStore } from "../../auth/service/auth_store";
import { CronService } from "../../cron/cron.service";

const ACTOR = {
  uuid: "rollback-owner-uuid",
  username: "rollbackowner",
  role: "owner",
};

describe("AdminService: атомарность мутаций", (): void => {
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

  it("setApproved синхронизирует статус одобрения в обоих сторах", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();

    await service.setApproved("rollbacktarget", false, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.approved).toBe(false);
    expect((await authStore.findByUsername("rollbacktarget"))?.approved).toBe(false);

    await service.setApproved("rollbacktarget", true, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
    expect((await authStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
  });

  it("setBanned синхронизирует статус бана в обоих сторах", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();

    await service.setBanned("rollbacktarget", true, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.banned).toBe(true);
    expect((await authStore.findByUsername("rollbacktarget"))?.banned).toBe(true);

    await service.setBanned("rollbacktarget", false, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.banned).toBe(false);
    expect((await authStore.findByUsername("rollbacktarget"))?.banned).toBe(false);
  });

  it("setApproved откатывает admin-стор при сбое auth-стора", async (): Promise<void> => {
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

  it("setBanned откатывает admin-стор при сбое auth-стора", async (): Promise<void> => {
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

  it("откат неудачной мутации не затирает конкурирующую мутацию другого админа", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const originalUpdateRole = authStore.updateRole.bind(authStore);
    const updateRole = spyOn(authStore, "updateRole").mockImplementationOnce(async () => {
      await adminStore.setRole("rollbacktarget", "admin");
      await originalUpdateRole("rollback-target-uuid", "admin");
      throw new Error("auth store down");
    });

    await expect(service.setRole("rollbacktarget", "moderator", ACTOR)).rejects.toThrow(
      "auth store down",
    );

    expect((await adminStore.findByUsername("rollbacktarget"))?.role).toBe("admin");
    expect((await authStore.findByUsername("rollbacktarget"))?.role).toBe("admin");
    updateRole.mockRestore();
  });

  it("мутация не проходит молча при конкурентном удалении пользователя", async (): Promise<void> => {
    const { adminStore, service } = await seed();
    const errorSpy = spyOn(
      (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      "error",
    );
    const setApproved = spyOn(adminStore, "setApproved").mockImplementationOnce(async () => {
      await adminStore.deleteUser("rollbacktarget");
      return false;
    });

    await expect(service.setApproved("rollbacktarget", false, ACTOR)).rejects.toThrow(
      NotFoundException,
    );

    expect(errorSpy).toHaveBeenCalled();
    setApproved.mockRestore();
    errorSpy.mockRestore();
  });

  it("повторная мутация тем же значением остаётся успешной", async (): Promise<void> => {
    const { adminStore, service } = await seed();

    await service.setApproved("rollbacktarget", true, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
  });

  it("гонка с повышением роли цели отменяет мутацию статуса", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    const originalSetApproved = adminStore.setApproved.bind(adminStore);
    const setApproved = spyOn(adminStore, "setApproved").mockImplementationOnce(
      async (username: string, approved: boolean, expectedRole?: string) => {
        await adminStore.setRole("rollbacktarget", "admin");
        await authStore.updateRole("rollback-target-uuid", "admin");
        return originalSetApproved(username, approved, expectedRole);
      },
    );

    await expect(service.setApproved("rollbacktarget", false, ACTOR)).rejects.toThrow(
      NotFoundException,
    );

    const target = await adminStore.findByUsername("rollbacktarget");
    expect(target?.approved).toBe(true);
    expect(target?.role).toBe("admin");
    expect((await authStore.findByUsername("rollbacktarget"))?.approved).toBe(true);
    setApproved.mockRestore();
  });

  it("гонка с повышением роли цели отменяет удаление", async (): Promise<void> => {
    const { adminStore, service } = await seed();
    const originalDeleteUser = adminStore.deleteUser.bind(adminStore);
    const deleteUser = spyOn(adminStore, "deleteUser").mockImplementationOnce(
      async (username: string, expectedRole?: string) => {
        await adminStore.setRole("rollbacktarget", "admin");
        return originalDeleteUser(username, expectedRole);
      },
    );

    await expect(service.deleteUser("rollbacktarget", ACTOR)).rejects.toThrow(NotFoundException);

    expect(await adminStore.findByUsername("rollbacktarget")).toBeDefined();
    deleteUser.mockRestore();
  });

  it("мутация проходит, когда роль цели совпадает со снимком", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();

    await service.setBanned("rollbacktarget", true, ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.banned).toBe(true);
    expect((await authStore.findByUsername("rollbacktarget"))?.banned).toBe(true);
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

  it("setUserPassword отклоняет короткий пароль", async (): Promise<void> => {
    const { authStore, service } = await seed();

    await expect(service.setUserPassword("rollbacktarget", "12345", ACTOR)).rejects.toThrow(
      BadRequestException,
    );

    const stored = await authStore.findByUsername("rollbacktarget");
    expect(await Bun.password.verify("rollbackpass", stored!.passwordHash)).toBe(true);
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

  it("restoreUser не теряет удалённые дубликаты при сбое auth-стора", async (): Promise<void> => {
    const { adminStore, authStore, service } = await seed();
    await adminStore.saveUser({
      uuid: "rollback-dup-uuid",
      username: "rollbacktarget",
      role: "user",
      approved: true,
      banned: false,
    });
    await service.deleteUser("rollbacktarget", ACTOR);
    await adminStore.deleteUser("rollbacktarget");
    const restoreUser = spyOn(authStore, "restoreUser").mockRejectedValue(
      new Error("auth store down"),
    );

    await expect(service.restoreUser("rollbacktarget", ACTOR)).rejects.toThrow("auth store down");

    const deletedPage = await adminStore.searchDeletedUsers({
      limit: 100,
      offset: 0,
      username: "rollbacktarget",
    });
    expect(deletedPage.items.map((item) => item.uuid).sort()).toEqual([
      "rollback-dup-uuid",
      "rollback-target-uuid",
    ]);
    restoreUser.mockRestore();
  });

  it("restoreUser подчищает дубликаты после успешного восстановления", async (): Promise<void> => {
    const { adminStore, service } = await seed();
    await adminStore.saveUser({
      uuid: "rollback-dup-uuid",
      username: "rollbacktarget",
      role: "user",
      approved: true,
      banned: false,
    });
    await service.deleteUser("rollbacktarget", ACTOR);
    await Bun.sleep(5);
    await adminStore.deleteUser("rollbacktarget");

    await service.restoreUser("rollbacktarget", ACTOR);

    expect((await adminStore.findByUsername("rollbacktarget"))?.uuid).toBe("rollback-dup-uuid");
    const deletedPage = await adminStore.searchDeletedUsers({
      limit: 100,
      offset: 0,
      username: "rollbacktarget",
    });
    expect(deletedPage.items).toEqual([]);
  });

  it("гонка с регистрацией при restore маппится в 409 «ник занят»", async (): Promise<void> => {
    const { adminStore, service } = await seed();
    await service.deleteUser("rollbacktarget", ACTOR);
    const restoreUser = spyOn(adminStore, "restoreUser").mockRejectedValue({ code: "23505" });

    await expect(service.restoreUser("rollbacktarget", ACTOR)).rejects.toThrow(ConflictException);
    await expect(service.restoreUser("rollbacktarget", ACTOR)).rejects.toThrow(
      "уже занят живым пользователем",
    );

    restoreUser.mockRestore();
  });
});
