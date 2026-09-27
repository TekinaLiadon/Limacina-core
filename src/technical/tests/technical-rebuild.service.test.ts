import { afterAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException, InternalServerErrorException } from "@nestjs/common";
import { TechnicalRebuildService } from "../technical-rebuild.service";
import { TechnicalRestartService } from "../technical-restart.service";
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
    RATE_LIMIT_AUTH_IP_MAX: 10,
    RATE_LIMIT_GLOBAL_MAX: 600,
    RATE_LIMIT_GLOBAL_WINDOW: 60000,
    BEHIND_PROXY: true,
    RCON_PORT: 25575,
    ...overrides,
  };
}

function makeRebuildService(config: AppConfigType = makeConfig()): {
  rebuild: TechnicalRebuildService;
  restart: TechnicalRestartService;
  signalled: () => boolean;
} {
  const restart = new TechnicalRestartService();
  let signalled = false;
  restart.sendShutdownSignal = () => {
    signalled = true;
  };
  const rebuild = new TechnicalRebuildService(config, restart);
  return { rebuild, restart, signalled: () => signalled };
}

function stubPipeline(
  rebuild: TechnicalRebuildService,
  options?: { gate?: Promise<void>; gitPullAfter?: string },
): () => string[] {
  const steps: string[] = [];
  rebuild.gitPull = async () => {
    steps.push("gitPull");
    if (options?.gate) await options.gate;
    return { before: "rev-before", after: options?.gitPullAfter ?? "rev-after" };
  };
  rebuild.installDependencies = async () => {
    steps.push("installDependencies");
  };
  rebuild.runMigrations = async () => {
    steps.push("runMigrations");
  };
  rebuild.buildBinary = async () => {
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

describe("TechnicalRebuildService", (): void => {
  describe("startRebuild", () => {
    it("запускает конвейер в фоне и подаёт сигнал после завершения", async () => {
      const { rebuild, signalled } = makeRebuildService();
      const steps = stubPipeline(rebuild);

      rebuild.startRebuild(actor);

      expect(rebuild.getRebuildStatus().inProgress).toBe(true);
      await waitFor(() => steps().length === 4);
      await waitFor(signalled);
      expect(rebuild.getRebuildStatus().inProgress).toBe(false);
      expect(rebuild.getRebuildStatus().lastError).toBeNull();
    });

    it("фиксирует ревизии git pull в статусе", async () => {
      const { rebuild } = makeRebuildService();
      stubPipeline(rebuild);

      rebuild.startRebuild(actor);
      await waitFor(() => rebuild.getRebuildStatus().inProgress === false);

      const status = rebuild.getRebuildStatus();
      expect(status.revisionBefore).toBe("rev-before");
      expect(status.revisionAfter).toBe("rev-after");
    });

    it("параллельный rebuild отклоняется, флаг снимается после сигнала", async () => {
      const { rebuild } = makeRebuildService();
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubPipeline(rebuild, { gate });

      rebuild.startRebuild(actor);
      await waitFor(() => rebuild.getRebuildStatus().inProgress === true);

      expect(() => rebuild.startRebuild(actor)).toThrow(ConflictException);
      expect(() => rebuild.startRebuild(actor)).toThrow("Пересборка уже выполняется");

      release();
      await waitFor(() => rebuild.getRebuildStatus().inProgress === false);
      expect(rebuild.getRebuildStatus().inProgress).toBe(false);
    });

    it("при падении шага снимает флаг, фиксирует ошибку и не перезапускает сервер", async () => {
      const { rebuild, signalled } = makeRebuildService();
      stubPipeline(rebuild);
      rebuild.gitPull = async () => {
        throw new InternalServerErrorException("Пересборка не удалась на шаге git pull");
      };

      rebuild.startRebuild(actor);

      await waitFor(() => rebuild.getRebuildStatus().lastError !== null);
      expect(rebuild.getRebuildStatus().inProgress).toBe(false);
      expect(rebuild.getRebuildStatus().lastError).toContain("git pull");
      await Bun.sleep(400);
      expect(signalled()).toBe(false);
    });

    it("прерывает конвейер при несовпадении ревизии с DEPLOY_PINNED_REVISION", async () => {
      const pinned = "b".repeat(40);
      const { rebuild, signalled } = makeRebuildService(
        makeConfig({ DEPLOY_PINNED_REVISION: pinned }),
      );
      const steps = stubPipeline(rebuild, { gitPullAfter: "a".repeat(40) });

      rebuild.startRebuild(actor);

      await waitFor(() => rebuild.getRebuildStatus().lastError !== null);
      expect(rebuild.getRebuildStatus().lastError).toContain("DEPLOY_PINNED_REVISION");
      expect(steps()).toEqual(["gitPull"]);
      await Bun.sleep(400);
      expect(signalled()).toBe(false);
    });

    it("продолжает конвейер при совпадении ревизии с DEPLOY_PINNED_REVISION", async () => {
      const pinned = "a".repeat(40);
      const { rebuild } = makeRebuildService(makeConfig({ DEPLOY_PINNED_REVISION: pinned }));
      const steps = stubPipeline(rebuild, { gitPullAfter: pinned });

      rebuild.startRebuild(actor);

      await waitFor(() => steps().length === 4);
      await waitFor(() => rebuild.getRebuildStatus().inProgress === false);
      expect(rebuild.getRebuildStatus().lastError).toBeNull();
    });

    it("выполняет шаги в порядке: pull → install → build → migrate (TASK-267.7)", async () => {
      const { rebuild } = makeRebuildService();
      const steps = stubPipeline(rebuild);

      rebuild.startRebuild(actor);
      await waitFor(() => rebuild.getRebuildStatus().inProgress === false);

      expect(steps()).toEqual(["gitPull", "installDependencies", "buildBinary", "runMigrations"]);
    });

    it("отклоняет пересборку при запланированной остановке сервера (TASK-267.8)", async () => {
      const { rebuild, restart, signalled } = makeRebuildService();
      const steps = stubPipeline(rebuild);

      await restart.restartServer(actor);
      expect(() => rebuild.startRebuild(actor)).toThrow(ConflictException);
      expect(() => rebuild.startRebuild(actor)).toThrow(
        "Перезапуск уже запланирован, пересборка отклонена",
      );
      expect(steps()).toEqual([]);

      await Bun.sleep(400);
      expect(signalled()).toBe(true);
      expect(rebuild.getRebuildStatus().inProgress).toBe(false);
    });

    it("отклоняет рестарт при активной пересборке (TASK-267.8)", async () => {
      const { rebuild, restart, signalled } = makeRebuildService();
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubPipeline(rebuild, { gate });

      rebuild.startRebuild(actor);
      await waitFor(() => rebuild.getRebuildStatus().inProgress === true);

      await expect(restart.restartServer(actor)).rejects.toThrow(ConflictException);
      await expect(restart.restartServer(actor)).rejects.toThrow(
        "Перезапуск отклонён: идёт пересборка",
      );

      release();
      await waitFor(signalled);
      expect(rebuild.getRebuildStatus().inProgress).toBe(false);
    });

    it("откатывает бинарник при упавших миграциях после успешной сборки (TASK-267.7)", async () => {
      const { rebuild, signalled } = makeRebuildService();
      stubPipeline(rebuild);
      rebuild.runMigrations = async () => {
        throw new InternalServerErrorException("Пересборка не удалась на шаге migrate:up");
      };
      const restored: string[] = [];
      rebuild.restoreBinary = async () => {
        restored.push("restore");
      };

      rebuild.startRebuild(actor);

      await waitFor(() => rebuild.getRebuildStatus().lastError !== null);
      expect(rebuild.getRebuildStatus().lastError).toContain("migrate:up");
      expect(restored).toEqual(["restore"]);
      await Bun.sleep(400);
      expect(signalled()).toBe(false);
    });
  });

  describe("резервная копия бинарника", () => {
    it("backupBinary копирует бинарник с сохранением прав", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const backupPath = join(dir, "Limacina.previous");
      const { rebuild } = makeRebuildService();
      try {
        await Bun.write(binaryPath, "BINARY-CONTENT");
        chmodSync(binaryPath, 0o755);

        await rebuild.backupBinary(binaryPath, backupPath);

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
      const { rebuild } = makeRebuildService();
      try {
        await rebuild.backupBinary(binaryPath, backupPath);

        expect(existsSync(backupPath)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("restoreBinary восстанавливает бинарник из копии", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const backupPath = join(dir, "Limacina.previous");
      const { rebuild } = makeRebuildService();
      try {
        await Bun.write(backupPath, "GOOD-BINARY");
        await Bun.write(binaryPath, "CORRUPTED-HALF");

        await rebuild.restoreBinary(binaryPath, backupPath);

        expect(await Bun.file(binaryPath).text()).toBe("GOOD-BINARY");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("restoreBinary не падает при отсутствии резервной копии", async () => {
      const dir = mkdtempSync(join(tmpdir(), "limacina-binary-"));
      const binaryPath = join(dir, "Limacina");
      const { rebuild } = makeRebuildService();
      try {
        await Bun.write(binaryPath, "CURRENT-BINARY");

        await rebuild.restoreBinary(binaryPath, join(dir, "missing.previous"));

        expect(await Bun.file(binaryPath).text()).toBe("CURRENT-BINARY");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("buildBinary откатывает бинарник при неудачной сборке", async () => {
      const { rebuild } = makeRebuildService();
      const calls: string[] = [];
      rebuild.backupBinary = async () => {
        calls.push("backup");
      };
      rebuild.restoreBinary = async () => {
        calls.push("restore");
      };
      rebuild.runBuildStep = async () => {
        calls.push("build");
        throw new InternalServerErrorException("Пересборка не удалась на шаге build");
      };

      await expect(rebuild.buildBinary()).rejects.toThrow(InternalServerErrorException);
      expect(calls).toEqual(["backup", "build", "restore"]);
    });

    it("buildBinary не откатывает бинарник при успешной сборке", async () => {
      const { rebuild } = makeRebuildService();
      const calls: string[] = [];
      rebuild.backupBinary = async () => {
        calls.push("backup");
      };
      rebuild.restoreBinary = async () => {
        calls.push("restore");
      };
      rebuild.runBuildStep = async () => {
        calls.push("build");
      };

      await rebuild.buildBinary();

      expect(calls).toEqual(["backup", "build"]);
    });

    it("buildBinary прерывается до сборки при неудачном бэкапе", async () => {
      const { rebuild } = makeRebuildService();
      const calls: string[] = [];
      rebuild.backupBinary = async () => {
        throw new InternalServerErrorException("Резервная копия бинарника не создана");
      };
      rebuild.runBuildStep = async () => {
        calls.push("build");
      };

      await expect(rebuild.buildBinary()).rejects.toThrow(InternalServerErrorException);
      expect(calls).toEqual([]);
    });
  });

  describe("реальные шаги конвейера", () => {
    const previousCwd = process.cwd();
    const tempDirs: string[] = [];

    afterAll((): void => {
      for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    function makeTempProject(files: Record<string, string> = {}): string {
      const dir = mkdtempSync(join(tmpdir(), "limacina-pipeline-"));
      tempDirs.push(dir);
      for (const [name, content] of Object.entries(files)) {
        const filePath = join(dir, name);
        mkdirSync(join(filePath, ".."), { recursive: true });
        writeFileSync(filePath, content);
      }
      return dir;
    }

    async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
      process.chdir(dir);
      try {
        return await fn();
      } finally {
        process.chdir(previousCwd);
      }
    }

    it("installDependencies выполняет установку в проекте с лок-файлом", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject({
        "package.json": JSON.stringify({
          name: "limacina-pipeline",
          private: true,
          dependencies: { localdep: "file:./localdep" },
        }),
        "localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
      });
      execSync("bun install", { cwd: dir });

      await withCwd(dir, () => rebuild.installDependencies());

      expect(existsSync(join(dir, "bun.lock"))).toBeTrue();
      expect(existsSync(join(dir, "node_modules", "localdep"))).toBeTrue();
    });

    it("runMigrations выполняет скрипт migrate:up проекта", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject({
        "package.json": JSON.stringify({
          name: "limacina-pipeline",
          private: true,
          scripts: { "migrate:up": "true" },
        }),
      });

      await withCwd(dir, () => rebuild.runMigrations());
    });

    it("runMigrations без проекта отклоняется с доменной ошибкой", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject();

      await withCwd(dir, async () => {
        await expect(rebuild.runMigrations()).rejects.toBeInstanceOf(InternalServerErrorException);
      });
    });

    it("onApplicationShutdown прерывает активный шаг конвейера (TASK-267.8)", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject({
        "package.json": JSON.stringify({
          name: "limacina-pipeline",
          private: true,
          scripts: { "migrate:up": "sleep 30" },
        }),
      });

      await withCwd(dir, async () => {
        const pending = rebuild.runMigrations();
        pending.catch(() => {});
        await rebuild.onApplicationShutdown();
        const error: unknown = await pending.then(
          () => {
            throw new Error("шаг не был прерван");
          },
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(InternalServerErrorException);
      });
    });

    it("buildBinary без бинарника и с успешной сборкой проходит", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject({
        "package.json": JSON.stringify({
          name: "limacina-pipeline",
          private: true,
          scripts: { build: "true" },
        }),
      });

      await withCwd(dir, () => rebuild.buildBinary());

      expect(existsSync(join(dir, "dist", "Limacina.previous"))).toBeFalse();
    });

    it("buildBinary при упавшей сборке восстанавливает бинарник из копии", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject({
        "package.json": JSON.stringify({
          name: "limacina-pipeline",
          private: true,
          scripts: { build: "false" },
        }),
        "dist/Limacina": "previous-binary-content",
      });

      await withCwd(dir, async () => {
        await expect(rebuild.buildBinary()).rejects.toBeInstanceOf(InternalServerErrorException);
      });

      expect(readFileSync(join(dir, "dist", "Limacina"), "utf8")).toBe("previous-binary-content");
    });

    it("gitPull в репозитории с локальным remote возвращает ревизии до и после", async () => {
      const { rebuild } = makeRebuildService();
      const baseDir = mkdtempSync(join(tmpdir(), "limacina-gitpull-"));
      tempDirs.push(baseDir);
      const repoDir = join(baseDir, "repo");
      execSync("git init -q --bare origin.git", { cwd: baseDir });
      execSync("git clone -q origin.git repo", { cwd: baseDir });
      execSync("git -c user.email=test@test -c user.name=test commit -q --allow-empty -m init", {
        cwd: repoDir,
      });
      execSync("git push -q -u origin HEAD", { cwd: repoDir });

      const revisions = await withCwd(repoDir, () => rebuild.gitPull());

      expect(revisions.before).toMatch(/^[0-9a-f]{40}$/);
      expect(revisions.after).toBe(revisions.before);
    });

    it("gitPull вне репозитория отклоняется с доменной ошибкой", async () => {
      const { rebuild } = makeRebuildService();
      const dir = makeTempProject();

      await withCwd(dir, async () => {
        await expect(rebuild.gitPull()).rejects.toBeInstanceOf(InternalServerErrorException);
      });
    });
  });
});
