import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { ConflictException, InternalServerErrorException, Logger } from "@nestjs/common";
import { TechnicalService, currentRevision, runStep } from "../technical.service";
import { AdminMapStore } from "../../admin/admin.store";
import { AuthMapStore } from "../../auth/service/auth_store.service";
import type { RequestUser } from "../../common/current-user.decorator";

const actor: RequestUser = { uuid: "owner-uuid", username: "owner", role: "owner" };

function makeService(): { service: TechnicalService; signalled: () => boolean } {
  const service = new TechnicalService(new AdminMapStore(), new AuthMapStore());
  let signalled = false;
  service.sendShutdownSignal = () => {
    signalled = true;
  };
  return { service, signalled: () => signalled };
}

function stubPipeline(service: TechnicalService, gate?: Promise<void>): () => string[] {
  const steps: string[] = [];
  service.gitPull = async () => {
    steps.push("gitPull");
    if (gate) await gate;
  };
  service.installDependencies = async () => {
    steps.push("installDependencies");
  };
  service.runMigrations = async () => {
    steps.push("runMigrations");
  };
  service.buildBinary = async () => {
    steps.push("buildBinary");
  };
  return () => steps;
}

describe("TechnicalService", (): void => {
  describe("initOwner", () => {
    it("создаёт владельца и возвращает uuid с юзернеймом", async () => {
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const service = new TechnicalService(adminStore, authStore);

      const result = await service.initOwner("owner", "securepassword");

      expect(result.username).toBe("owner");
      expect(result.uuid).toHaveLength(32);
      expect(await adminStore.hasOwner()).toBe(true);
      expect((await adminStore.findByUsername("owner"))?.role).toBe("owner");
      expect((await authStore.findByUsername("owner"))?.role).toBe("owner");
    });

    it("возвращает 409 если владелец уже создан", async () => {
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const service = new TechnicalService(adminStore, authStore);
      await service.initOwner("firstowner", "securepassword");

      await expect(service.initOwner("secondowner", "securepassword")).rejects.toThrow(
        ConflictException,
      );
      await expect(service.initOwner("secondowner", "securepassword")).rejects.toThrow(
        "Владелец уже создан",
      );
    });

    it("возвращает 409 если юзернейм занят", async () => {
      const authStore = new AuthMapStore();
      await authStore.saveUser({
        uuid: "taken-username-uuid",
        username: "occupied",
        passwordHash: "hash",
        role: "user",
        approved: true,
        banned: false,
      });
      const service = new TechnicalService(new AdminMapStore(), authStore);

      await expect(service.initOwner("occupied", "securepassword")).rejects.toThrow(
        "Юзернейм уже занят",
      );
    });
  });

  describe("runStep", () => {
    const logger = new Logger("runStep");

    it("выполняет шаг с нулевым кодом выхода", async () => {
      await runStep(logger, "version", ["bun", "--version"], 30_000);
    });

    it("бросает 500 при ненулевом коде выхода", async () => {
      await expect(
        runStep(logger, "fail-step", ["bun", "-e", "process.exit(3)"], 30_000),
      ).rejects.toThrow(InternalServerErrorException);
      await expect(
        runStep(logger, "fail-step", ["bun", "-e", "process.exit(3)"], 30_000),
      ).rejects.toThrow("fail-step");
    });

    it("прерывает зависший шаг по таймауту", async () => {
      await expect(
        runStep(logger, "hang-step", ["bun", "-e", "await Bun.sleep(30_000)"], 300),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("currentRevision", () => {
    it("возвращает хеш текущего коммита", async () => {
      expect((await currentRevision()).length).toBe(40);
    });
  });

  describe("restartServer", () => {
    it("без rebuild не запускает шаги конвейера", async () => {
      const { service, signalled } = makeService();
      const steps = stubPipeline(service);

      await service.restartServer(false, actor);
      await Bun.sleep(400);

      expect(steps()).toEqual([]);
      expect(signalled()).toBe(true);
    });

    it("rebuild выполняет конвейер в порядке git pull → install → migrate → build", async () => {
      const { service, signalled } = makeService();
      const steps = stubPipeline(service);

      await service.restartServer(true, actor);

      expect(steps()).toEqual(["gitPull", "installDependencies", "runMigrations", "buildBinary"]);
      await Bun.sleep(400);
      expect(signalled()).toBe(true);
    });

    it("параллельный rebuild отклоняется, флаг снимается после сигнала", async () => {
      const { service, signalled } = makeService();
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubPipeline(service, gate);

      const first = service.restartServer(true, actor);
      await expect(service.restartServer(true, actor)).rejects.toThrow(ConflictException);
      await expect(service.restartServer(true, actor)).rejects.toThrow(
        "Пересборка уже выполняется",
      );

      release();
      await first;
      expect(signalled()).toBe(false);

      await Bun.sleep(400);
      expect(signalled()).toBe(true);

      await service.restartServer(true, actor);
    });

    it("при падении шага флаг снимается и перезапуска нет", async () => {
      const { service, signalled } = makeService();
      stubPipeline(service);
      service.gitPull = async () => {
        throw new InternalServerErrorException("Пересборка не удалась на шаге git pull");
      };

      await expect(service.restartServer(true, actor)).rejects.toThrow(
        InternalServerErrorException,
      );
      await Bun.sleep(400);
      expect(signalled()).toBe(false);

      service.gitPull = async () => {};
      await service.restartServer(true, actor);
      await Bun.sleep(400);
      expect(signalled()).toBe(true);
    });
  });

  describe("buildBinary", () => {
    it("собирает бинарник через bun run build", async () => {
      const service = new TechnicalService(new AdminMapStore(), new AuthMapStore());
      await service.buildBinary();
      expect(existsSync("dist/Limacina")).toBe(true);
    });
  });
});
