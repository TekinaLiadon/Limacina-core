import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException, InternalServerErrorException, Logger } from "@nestjs/common";
import {
  TechnicalService,
  buildInstallCommand,
  buildStepEnv,
  currentRevision,
  runStep,
} from "../technical.service";
import { AdminMapStore } from "../../admin/admin.store";
import { AuthMapStore } from "../../auth/service/auth_store.service";
import type { AppConfigType } from "../../config/global-config";
import type { RequestUser } from "../../common/current-user.decorator";

const actor: RequestUser = { uuid: "owner-uuid", username: "owner", role: "owner" };

function makeConfig(overrides: Partial<AppConfigType> = {}): AppConfigType {
  return {
    NODE_ENV: "test",
    PORT: 3005,
    JWT_ACCESS: "test-access-secret-0123456789abcdef0123",
    JWT_REFRESH: "test-refresh-secret-0123456789abcdef0123",
    DB_DRIVER: "map",
    BASE_URL: "http://localhost:3005",
    MAX_SKINS_PER_USER: 1,
    MAX_MODELS_PER_USER: 1,
    MAX_CAPES_PER_USER: 1,
    RATE_LIMIT_AUTH_MAX: 10,
    RATE_LIMIT_AUTH_WINDOW: 60000,
    ...overrides,
  };
}

function makeService(config: AppConfigType = makeConfig()): {
  service: TechnicalService;
  signalled: () => boolean;
} {
  const service = new TechnicalService(new AdminMapStore(), new AuthMapStore(), config);
  let signalled = false;
  service.sendShutdownSignal = () => {
    signalled = true;
  };
  return { service, signalled: () => signalled };
}

function stubPipeline(
  service: TechnicalService,
  options?: { gate?: Promise<void>; gitPullAfter?: string },
): () => string[] {
  const steps: string[] = [];
  service.gitPull = async () => {
    steps.push("gitPull");
    if (options?.gate) await options.gate;
    return { before: "rev-before", after: options?.gitPullAfter ?? "rev-after" };
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

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: условие не выполнено за отведённое время");
    }
    await Bun.sleep(20);
  }
}

describe("TechnicalService", (): void => {
  describe("initOwner", () => {
    it("создаёт владельца и возвращает uuid с юзернеймом", async () => {
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const service = new TechnicalService(adminStore, authStore, makeConfig());

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
      const service = new TechnicalService(adminStore, authStore, makeConfig());
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
      const service = new TechnicalService(new AdminMapStore(), authStore, makeConfig());

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

    it("возвращает 500 вместо сырой ошибки при отсутствии команды", async () => {
      await expect(
        runStep(logger, "missing-step", ["limacina-missing-cmd-xyz"], 5000),
      ).rejects.toThrow(InternalServerErrorException);
      await expect(
        runStep(logger, "missing-step", ["limacina-missing-cmd-xyz"], 5000),
      ).rejects.toThrow("missing-step");
    });

    it("эскалирует SIGKILL для процесса, игнорирующего SIGTERM", async () => {
      await expect(
        runStep(
          logger,
          "hang-step",
          ["bun", "-e", "process.on('SIGTERM', () => {}); await Bun.sleep(30_000)"],
          250,
          300,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("передаёт GIT_SSH_COMMAND в окружение шага", async () => {
      await runStep(
        logger,
        "env-step",
        [
          "bun",
          "-e",
          "process.exit(process.env.GIT_SSH_COMMAND === 'ssh -o BatchMode=yes' ? 0 : 9)",
        ],
        30_000,
      );
    });
  });

  describe("currentRevision", () => {
    const logger = new Logger("currentRevision");

    it("возвращает хеш текущего коммита", async () => {
      expect((await currentRevision(logger)).length).toBe(40);
    });

    it("возвращает unknown вне git-репозитория", async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "limacina-rev-"));
      try {
        expect(await currentRevision(logger, outsideDir)).toBe("unknown");
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("restartServer", () => {
    it("перезапускает сервер без запуска конвейера", async () => {
      const { service, signalled } = makeService();
      const steps = stubPipeline(service);

      await service.restartServer(actor);
      await Bun.sleep(400);

      expect(steps()).toEqual([]);
      expect(signalled()).toBe(true);
    });
  });

  describe("startRebuild", () => {
    it("запускает конвейер в фоне и подаёт сигнал после завершения", async () => {
      const { service, signalled } = makeService();
      const steps = stubPipeline(service);

      service.startRebuild(actor);

      expect(service.getRebuildStatus().inProgress).toBe(true);
      await waitFor(() => steps().length === 4);
      await waitFor(signalled);
      expect(service.getRebuildStatus().inProgress).toBe(false);
      expect(service.getRebuildStatus().lastError).toBeNull();
    });

    it("фиксирует ревизии git pull в статусе", async () => {
      const { service } = makeService();
      stubPipeline(service);

      service.startRebuild(actor);
      await waitFor(() => service.getRebuildStatus().inProgress === false);

      const status = service.getRebuildStatus();
      expect(status.revisionBefore).toBe("rev-before");
      expect(status.revisionAfter).toBe("rev-after");
    });

    it("параллельный rebuild отклоняется, флаг снимается после сигнала", async () => {
      const { service } = makeService();
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubPipeline(service, { gate });

      service.startRebuild(actor);
      await waitFor(() => service.getRebuildStatus().inProgress === true);

      expect(() => service.startRebuild(actor)).toThrow(ConflictException);
      expect(() => service.startRebuild(actor)).toThrow("Пересборка уже выполняется");

      release();
      await waitFor(() => service.getRebuildStatus().inProgress === false);
      expect(service.getRebuildStatus().inProgress).toBe(false);
    });

    it("при падении шага снимает флаг, фиксирует ошибку и не перезапускает сервер", async () => {
      const { service, signalled } = makeService();
      stubPipeline(service);
      service.gitPull = async () => {
        throw new InternalServerErrorException("Пересборка не удалась на шаге git pull");
      };

      service.startRebuild(actor);

      await waitFor(() => service.getRebuildStatus().lastError !== null);
      expect(service.getRebuildStatus().inProgress).toBe(false);
      expect(service.getRebuildStatus().lastError).toContain("git pull");
      await Bun.sleep(400);
      expect(signalled()).toBe(false);
    });

    it("прерывает конвейер при несовпадении ревизии с DEPLOY_PINNED_REVISION", async () => {
      const pinned = "b".repeat(40);
      const { service, signalled } = makeService(makeConfig({ DEPLOY_PINNED_REVISION: pinned }));
      const steps = stubPipeline(service, { gitPullAfter: "a".repeat(40) });

      service.startRebuild(actor);

      await waitFor(() => service.getRebuildStatus().lastError !== null);
      expect(service.getRebuildStatus().lastError).toContain("DEPLOY_PINNED_REVISION");
      expect(steps()).toEqual(["gitPull"]);
      await Bun.sleep(400);
      expect(signalled()).toBe(false);
    });

    it("продолжает конвейер при совпадении ревизии с DEPLOY_PINNED_REVISION", async () => {
      const pinned = "a".repeat(40);
      const { service } = makeService(makeConfig({ DEPLOY_PINNED_REVISION: pinned }));
      const steps = stubPipeline(service, { gitPullAfter: pinned });

      service.startRebuild(actor);

      await waitFor(() => steps().length === 4);
      await waitFor(() => service.getRebuildStatus().inProgress === false);
      expect(service.getRebuildStatus().lastError).toBeNull();
    });
  });

  describe("резервная копия бинарника", () => {
    it("backupBinary копирует бинарник с сохранением прав", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const backupPath = join(dir, "Limacina.previous");
      const { service } = makeService();
      try {
        await Bun.write(binaryPath, "BINARY-CONTENT");
        chmodSync(binaryPath, 0o755);

        await service.backupBinary(binaryPath, backupPath);

        expect(await Bun.file(backupPath).text()).toBe("BINARY-CONTENT");
        expect(statSync(backupPath).mode & 0o777).toBe(0o755);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("backupBinary пропускает копирование при отсутствии бинарника", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const backupPath = join(dir, "Limacina.previous");
      const { service } = makeService();
      try {
        await service.backupBinary(binaryPath, backupPath);

        expect(existsSync(backupPath)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("restoreBinary восстанавливает бинарник из копии", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const backupPath = join(dir, "Limacina.previous");
      const { service } = makeService();
      try {
        await Bun.write(backupPath, "GOOD-BINARY");
        await Bun.write(binaryPath, "CORRUPTED-HALF");

        await service.restoreBinary(binaryPath, backupPath);

        expect(await Bun.file(binaryPath).text()).toBe("GOOD-BINARY");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("restoreBinary не падает при отсутствии резервной копии", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const { service } = makeService();
      try {
        await Bun.write(binaryPath, "CURRENT-BINARY");

        await service.restoreBinary(binaryPath, join(dir, "missing.previous"));

        expect(await Bun.file(binaryPath).text()).toBe("CURRENT-BINARY");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("buildBinary откатывает бинарник при неудачной сборке", async () => {
      const { service } = makeService();
      const calls: string[] = [];
      service.backupBinary = async () => {
        calls.push("backup");
      };
      service.restoreBinary = async () => {
        calls.push("restore");
      };
      service.runBuildStep = async () => {
        calls.push("build");
        throw new InternalServerErrorException("Пересборка не удалась на шаге build");
      };

      await expect(service.buildBinary()).rejects.toThrow(InternalServerErrorException);
      expect(calls).toEqual(["backup", "build", "restore"]);
    });

    it("buildBinary не откатывает бинарник при успешной сборке", async () => {
      const { service } = makeService();
      const calls: string[] = [];
      service.backupBinary = async () => {
        calls.push("backup");
      };
      service.restoreBinary = async () => {
        calls.push("restore");
      };
      service.runBuildStep = async () => {
        calls.push("build");
      };

      await service.buildBinary();

      expect(calls).toEqual(["backup", "build"]);
    });

    it("buildBinary прерывается до сборки при неудачном бэкапе", async () => {
      const { service } = makeService();
      const calls: string[] = [];
      service.backupBinary = async () => {
        throw new InternalServerErrorException("Резервная копия бинарника не создана");
      };
      service.runBuildStep = async () => {
        calls.push("build");
      };

      await expect(service.buildBinary()).rejects.toThrow(InternalServerErrorException);
      expect(calls).toEqual([]);
    });
  });

  describe("buildInstallCommand", () => {
    it("добавляет --frozen-lockfile при наличии лок-файла", () => {
      expect(buildInstallCommand(true)).toEqual(["bun", "install", "--frozen-lockfile"]);
    });

    it("без лок-файла запускает обычную установку", () => {
      expect(buildInstallCommand(false)).toEqual(["bun", "install"]);
    });
  });

  describe("buildStepEnv", () => {
    it("передаёт GIT_SSH_COMMAND и не пропускает SECRETS дочерним процессам", () => {
      const savedSecrets = process.env["SECRETS"];
      process.env["SECRETS"] = JSON.stringify({ JWT_ACCESS: "super-secret-value" });
      try {
        const stepEnv = buildStepEnv();
        expect(stepEnv["GIT_SSH_COMMAND"]).toBe("ssh -o BatchMode=yes");
        expect("SECRETS" in stepEnv).toBe(false);
        expect(JSON.stringify(stepEnv)).not.toContain("super-secret-value");
      } finally {
        if (savedSecrets === undefined) delete process.env["SECRETS"];
        else process.env["SECRETS"] = savedSecrets;
      }
    });
  });
});
