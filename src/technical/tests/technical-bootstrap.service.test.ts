import { describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { TechnicalBootstrapService } from "../technical-bootstrap.service";
import { AdminMapStore } from "../../admin/admin_store";
import { AuthMapStore } from "../../auth/service/auth_store";

function captureStdout(): { lines: () => string; restore: () => void } {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return {
    lines: () => chunks.join(""),
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

describe("TechnicalBootstrapService", (): void => {
  describe("initOwner", () => {
    it("первый старт без владельца создаёт токен-файл и выводит токен в stdout", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      const stdout = captureStdout();
      try {
        await service.onApplicationBootstrap();

        const token = (await Bun.file(tokenPath).text()).trim();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(stdout.lines()).toContain(token);
      } finally {
        stdout.restore();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("принимает валидный токен, создаёт владельца и удаляет токен-файл", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        const result = await service.initOwner("owner", "securepassword", token);

        expect(result.username).toBe("owner");
        expect(result.uuid).toHaveLength(32);
        expect(existsSync(tokenPath)).toBe(false);
        expect(await adminStore.hasOwner()).toBe(true);
        expect((await adminStore.findByUsername("owner"))?.role).toBe("owner");
        expect((await authStore.findByUsername("owner"))?.role).toBe("owner");

        await expect(service.initOwner("secondowner", "securepassword", token)).rejects.toThrow(
          "Владелец уже создан",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("отклоняет короткий пароль до создания владельца (TASK-265)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        await expect(service.initOwner("owner", "12345", token)).rejects.toThrow(
          BadRequestException,
        );

        expect(await adminStore.hasOwner()).toBe(false);
        expect(await authStore.findByUsername("owner")).toBeUndefined();
        expect(existsSync(tokenPath)).toBe(true);

        const result = await service.initOwner("owner", "securepassword", token);

        expect(result.username).toBe("owner");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("отклоняет неверный токен до создания владельца и сохраняет файл", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();

        await expect(service.initOwner("owner", "securepassword", "f".repeat(64))).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service.initOwner("owner", "securepassword", "f".repeat(64))).rejects.toThrow(
          "Неверный токен инициализации владельца",
        );

        expect(existsSync(tokenPath)).toBe(true);
        expect(await adminStore.hasOwner()).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("отклоняет запрос, если бустстрап-токен не создан", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const service = new TechnicalBootstrapService(
        new AdminMapStore(),
        new AuthMapStore(),
        join(dir, "bootstrap.token"),
      );
      try {
        await expect(service.initOwner("owner", "securepassword", "a".repeat(64))).rejects.toThrow(
          "Токен инициализации владельца недоступен",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("при рестарте читает существующий файл, не перегенерируя токен", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const first = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await first.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        const second = new TechnicalBootstrapService(
          new AdminMapStore(),
          new AuthMapStore(),
          tokenPath,
        );
        await second.onApplicationBootstrap();

        expect((await Bun.file(tokenPath).text()).trim()).toBe(token);
        const result = await second.initOwner("owner", "securepassword", token);
        expect(result.username).toBe("owner");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("при существующем владельце не создаёт токен и подчищает stale-файл", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await adminStore.saveUser({
          uuid: "owner-uuid",
          username: "owner",
          role: "owner",
          approved: true,
          banned: false,
        });
        await Bun.write(tokenPath, "stale-token");

        await service.onApplicationBootstrap();

        expect(existsSync(tokenPath)).toBe(false);
        await expect(
          service.initOwner("newcomer", "securepassword", "stale-token"),
        ).rejects.toThrow("Владелец уже создан");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("параллельные вызовы с одним токеном создают ровно одного владельца", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        const results = await Promise.allSettled([
          service.initOwner("winner", "securepassword", token),
          service.initOwner("loser", "securepassword", token),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        expect(fulfilled).toHaveLength(1);
        expect(await adminStore.hasOwner()).toBe(true);
        expect((await adminStore.findByUsername("winner"))?.role).toBe("owner");
        expect(await adminStore.findByUsername("loser")).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("восстанавливает токен при неудаче создания владельца", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const authStore = new AuthMapStore();
      await authStore.saveUser({
        uuid: "taken-username-uuid",
        username: "occupied",
        passwordHash: "hash",
        role: "user",
        approved: true,
        banned: false,
      });
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(new AdminMapStore(), authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        await expect(service.initOwner("occupied", "securepassword", token)).rejects.toThrow(
          "Юзернейм уже занят",
        );
        expect(existsSync(tokenPath)).toBe(true);

        const result = await service.initOwner("owner", "securepassword", token);
        expect(result.username).toBe("owner");
        expect(existsSync(tokenPath)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("при сбое отката auth-записи повторяет deleteUser и завершает init-owner явной ошибкой (TASK-269.16)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        const saveUser = spyOn(adminStore, "saveUser").mockRejectedValue(
          new Error("admin store down"),
        );
        const originalDelete = authStore.deleteUser.bind(authStore);
        const deleteUser = spyOn(authStore, "deleteUser")
          .mockRejectedValueOnce(new Error("rollback down"))
          .mockRejectedValueOnce(new Error("rollback down"))
          .mockImplementationOnce((userUuid: string) => originalDelete(userUuid));

        await expect(service.initOwner("owner", "securepassword", token)).rejects.toThrow(
          "admin store down",
        );
        expect(deleteUser).toHaveBeenCalledTimes(3);
        expect(await authStore.findByUsername("owner")).toBeUndefined();
        expect(existsSync(tokenPath)).toBe(true);

        saveUser.mockRestore();
        const result = await service.initOwner("owner", "securepassword", token);
        expect(result.username).toBe("owner");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("неудавшийся откат auth-записи не оставляет второго владельца при повторном init-owner (TASK-269.16)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const service = new TechnicalBootstrapService(adminStore, authStore, tokenPath);
      try {
        await service.onApplicationBootstrap();
        const token = (await Bun.file(tokenPath).text()).trim();

        const saveUser = spyOn(adminStore, "saveUser").mockRejectedValue(
          new Error("admin store down"),
        );
        const deleteUser = spyOn(authStore, "deleteUser").mockRejectedValue(
          new Error("rollback down"),
        );

        await expect(service.initOwner("orphan", "securepassword", token)).rejects.toThrow(
          InternalServerErrorException,
        );
        await expect(service.initOwner("orphan", "securepassword", token)).rejects.toThrow(
          "Юзернейм уже занят",
        );

        expect(await adminStore.hasOwner()).toBe(false);
        saveUser.mockRestore();
        deleteUser.mockRestore();

        await expect(service.initOwner("orphan", "securepassword", token)).rejects.toThrow(
          "Юзернейм уже занят",
        );
        expect((await authStore.findByUsername("orphan"))?.role).toBe("owner");
        expect(await adminStore.findByUsername("orphan")).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("диагностика ошибок bootstrap-токена (TASK-267.17)", () => {
    it("ошибка проверки владельца логируется отдельным сообщением без создания токена", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const adminStore = new AdminMapStore();
      const tokenPath = join(dir, "bootstrap.token");
      const hasOwner = spyOn(adminStore, "hasOwner").mockRejectedValue(new Error("db down"));
      const service = new TechnicalBootstrapService(adminStore, new AuthMapStore(), tokenPath);
      const errorSpy = spyOn(Logger.prototype, "error");
      try {
        await service.onApplicationBootstrap();

        const payloads = errorSpy.mock.calls.map((call) => JSON.stringify(call));
        expect(
          payloads.some((payload) => payload.includes("Не удалось проверить наличие владельца")),
        ).toBe(true);
        expect(existsSync(tokenPath)).toBe(false);

        hasOwner.mockRestore();
        await expect(service.initOwner("owner", "securepassword", "a".repeat(64))).rejects.toThrow(
          "Токен инициализации владельца недоступен",
        );
      } finally {
        errorSpy.mockRestore();
        hasOwner.mockRestore();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("ошибка записи токен-файла логируется отдельным сообщением", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-bootstrap-"));
      const service = new TechnicalBootstrapService(
        new AdminMapStore(),
        new AuthMapStore(),
        join(dir, "missing-subdir", "bootstrap.token"),
      );
      const errorSpy = spyOn(Logger.prototype, "error");
      try {
        await service.onApplicationBootstrap();

        const payloads = errorSpy.mock.calls.map((call) => JSON.stringify(call));
        expect(payloads.some((payload) => payload.includes("Bootstrap-токен не записан"))).toBe(
          true,
        );
        await expect(service.initOwner("owner", "securepassword", "a".repeat(64))).rejects.toThrow(
          "Токен инициализации владельца недоступен",
        );
      } finally {
        errorSpy.mockRestore();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
