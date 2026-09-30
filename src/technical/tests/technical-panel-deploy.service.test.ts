import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import {
  PANEL_DEPLOY_LOCK_STALE_MS,
  assertValidPanelRef,
  acquirePanelDeployLock,
  releasePanelDeployLock,
  resolveDefaultBranch,
  runPanelStep,
  swapPanelDirectory,
  TechnicalPanelDeployService,
} from "../technical-panel-deploy.service";
import {
  DEFAULT_PANEL_PUBLIC_DIR,
  DEFAULT_PANEL_REPO_DIR,
  PANEL_DIR_NAME,
  PROJECT_ROOT,
  buildPanelBackupName,
  buildPanelDeployLockPath,
  isPanelBackupEntry,
} from "../panel-deploy-dirs";

const FIXTURE_PACKAGE = JSON.stringify({
  name: "limacina-panel-fixture",
  private: true,
  scripts: { build: "mkdir -p .output/public && cp page.html .output/public/index.html" },
});

const GIT_AUTHOR = ["-c", "user.name=fixture", "-c", "user.email=fixture@limacina.local"];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function canTestPermissions(): boolean {
  return process.platform !== "win32" && process.getuid !== undefined && process.getuid() !== 0;
}

describe("TechnicalPanelDeployService — деплой админ-панели", (): void => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "limacina-panel-fixture-"));
  const panelFixture = join(fixtureRoot, "panel-repo");
  const failingFixture = join(fixtureRoot, "failing-repo");
  const noOutputFixture = join(fixtureRoot, "no-output-repo");
  const workdirs: string[] = [];
  const logger = new Logger("TechnicalPanelDeployService");

  function makeWorkDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "limacina-panel-work-"));
    workdirs.push(dir);
    return dir;
  }

  function createService(
    fixture: string,
    dirs?: { repoDir: string; publicDir: string },
  ): { service: TechnicalPanelDeployService; repoDir: string; publicDir: string } {
    const repoDir = dirs?.repoDir ?? makeWorkDir();
    const publicDir = dirs?.publicDir ?? makeWorkDir();
    const service = new TechnicalPanelDeployService({
      repoUrl: fixture,
      repoDir,
      publicDir,
    });
    return { service, repoDir, publicDir };
  }

  function panelContent(publicDir: string): string {
    return readFileSync(join(publicDir, PANEL_DIR_NAME, "index.html"), "utf-8").trim();
  }

  function backupEntries(publicDir: string): string[] {
    if (!existsSync(publicDir)) return [];
    return readdirSync(publicDir).filter(isPanelBackupEntry);
  }

  beforeAll((): void => {
    git(["init", "-b", "main", panelFixture], fixtureRoot);
    writeFileSync(join(panelFixture, "package.json"), FIXTURE_PACKAGE);
    writeFileSync(join(panelFixture, "page.html"), "panel-v1");
    git(["add", "-A"], panelFixture);
    git([...GIT_AUTHOR, "commit", "-m", "v1"], panelFixture);
    git(["tag", "v1.0.0"], panelFixture);
    writeFileSync(join(panelFixture, "page.html"), "panel-v2");
    git(["add", "-A"], panelFixture);
    git([...GIT_AUTHOR, "commit", "-m", "v2"], panelFixture);

    git(["init", "-b", "main", failingFixture], fixtureRoot);
    writeFileSync(
      join(failingFixture, "package.json"),
      JSON.stringify({
        name: "limacina-panel-failing",
        private: true,
        scripts: { build: "exit 1" },
      }),
    );
    git(["add", "-A"], failingFixture);
    git([...GIT_AUTHOR, "commit", "-m", "failing build"], failingFixture);

    git(["init", "-b", "main", noOutputFixture], fixtureRoot);
    writeFileSync(
      join(noOutputFixture, "package.json"),
      JSON.stringify({
        name: "limacina-panel-no-output",
        private: true,
        scripts: { build: "mkdir -p .output/public" },
      }),
    );
    git(["add", "-A"], noOutputFixture);
    git([...GIT_AUTHOR, "commit", "-m", "no output"], noOutputFixture);
  });

  afterAll((): void => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    for (const dir of workdirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("разворачивает сборку панели в public/panel: clone → install → build → swap", async (): Promise<void> => {
    const { service, publicDir } = createService(panelFixture);

    const result = await service.deploy();

    expect(result.ref).toBe("main");
    expect(result.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(result.panelDir).toBe(join(publicDir, PANEL_DIR_NAME));
    expect(panelContent(publicDir)).toBe("panel-v2");
  }, 30_000);

  it("повторный деплой переиспользует чекаут и обновляет панель", async (): Promise<void> => {
    const { service, publicDir } = createService(panelFixture);
    await service.deploy();

    const result = await service.deploy();

    expect(result.ref).toBe("main");
    expect(panelContent(publicDir)).toBe("panel-v2");
  }, 30_000);

  it("деплой по тегу откатывает версию, повторный деплой по умолчанию возвращается на ветку", async (): Promise<void> => {
    const { service, publicDir } = createService(panelFixture);

    const tagged = await service.deploy("v1.0.0");
    expect(tagged.ref).toBe("v1.0.0");
    expect(panelContent(publicDir)).toBe("panel-v1");

    const latest = await service.deploy();
    expect(latest.ref).toBe("main");
    expect(panelContent(publicDir)).toBe("panel-v2");
  }, 30_000);

  it("первый деплой создаёт каталог панели без резервных копий", async (): Promise<void> => {
    const { service, publicDir } = createService(panelFixture);
    expect(existsSync(join(publicDir, PANEL_DIR_NAME))).toBe(false);

    await service.deploy();

    expect(panelContent(publicDir)).toBe("panel-v2");
    expect(backupEntries(publicDir)).toHaveLength(0);
  }, 30_000);

  it("неудачная сборка сохраняет предыдущую панель", async (): Promise<void> => {
    const { publicDir } = createService(panelFixture);
    await new TechnicalPanelDeployService({
      repoUrl: panelFixture,
      repoDir: makeWorkDir(),
      publicDir,
    }).deploy();
    const { service } = createService(failingFixture, {
      repoDir: makeWorkDir(),
      publicDir,
    });

    await expect(service.deploy()).rejects.toThrow("bun run build");

    expect(panelContent(publicDir)).toBe("panel-v2");
    expect(backupEntries(publicDir)).toHaveLength(0);
  }, 30_000);

  it("сборка без index.html прерывает деплой до подмены каталога", async (): Promise<void> => {
    const { publicDir } = createService(panelFixture);
    await new TechnicalPanelDeployService({
      repoUrl: panelFixture,
      repoDir: makeWorkDir(),
      publicDir,
    }).deploy();
    const { service } = createService(noOutputFixture, {
      repoDir: makeWorkDir(),
      publicDir,
    });

    await expect(service.deploy()).rejects.toThrow("index.html");

    expect(panelContent(publicDir)).toBe("panel-v2");
    expect(backupEntries(publicDir)).toHaveLength(0);
  }, 30_000);

  it("неудачный clone не трогает существующую панель", async (): Promise<void> => {
    const { publicDir } = createService(panelFixture);
    await new TechnicalPanelDeployService({
      repoUrl: panelFixture,
      repoDir: makeWorkDir(),
      publicDir,
    }).deploy();
    const { service } = createService(join(fixtureRoot, "absent-repo"), {
      repoDir: makeWorkDir(),
      publicDir,
    });

    await expect(service.deploy()).rejects.toThrow("git clone");

    expect(panelContent(publicDir)).toBe("panel-v2");
  }, 30_000);

  it("отклоняет ref с ведущим дефисом до любых git-команд", async (): Promise<void> => {
    const { service, repoDir, publicDir } = createService(panelFixture);

    await expect(service.deploy("--orphan")).rejects.toThrow("Недопустимый ref");
    await expect(service.deploy("-b evil")).rejects.toThrow("Недопустимый ref");

    expect(existsSync(join(repoDir, ".git"))).toBe(false);
    expect(existsSync(join(publicDir, PANEL_DIR_NAME))).toBe(false);
  }, 30_000);

  it("отклоняет ref вне допустимого паттерна", (): void => {
    for (const ref of ["bad ref", "main;rm", "ref|pipe", "", "main\norphan"]) {
      expect(() => assertValidPanelRef(ref)).toThrow("Недопустимый ref");
    }
    expect(() => assertValidPanelRef("v1.0.0")).not.toThrow();
    expect(() => assertValidPanelRef("feature/panel_2")).not.toThrow();
    expect(() => assertValidPanelRef("9c49fcba1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d")).not.toThrow();
  });

  it("убитый clone оставляет сломанный repoDir — следующий деплой пересоздаёт его", async (): Promise<void> => {
    const { publicDir } = createService(panelFixture);
    const brokenRepoDir = makeWorkDir();
    writeFileSync(join(brokenRepoDir, "leftover.lock"), "partial clone");
    const { service } = createService(panelFixture, {
      repoDir: brokenRepoDir,
      publicDir,
    });

    const result = await service.deploy();

    expect(result.ref).toBe("main");
    expect(panelContent(publicDir)).toBe("panel-v2");
    expect(existsSync(join(brokenRepoDir, ".git"))).toBe(true);
  }, 30_000);

  it("deploy() восстанавливает панель из crash-окна подмены", async (): Promise<void> => {
    const { service, publicDir } = createService(panelFixture);
    const backupPath = join(publicDir, buildPanelBackupName("crash-window"));
    mkdirSync(backupPath, { recursive: true });
    writeFileSync(join(backupPath, "index.html"), "panel-crashed");

    const result = await service.deploy();

    expect(result.ref).toBe("main");
    expect(panelContent(publicDir)).toBe("panel-v2");
    expect(backupEntries(publicDir)).toHaveLength(0);
  }, 30_000);

  it("дефолтные каталоги якорятся к корню проекта независимо от cwd", (): void => {
    expect(DEFAULT_PANEL_REPO_DIR).toBe(join(PROJECT_ROOT, "tmp", "panel-admin"));
    expect(DEFAULT_PANEL_PUBLIC_DIR).toBe(join(PROJECT_ROOT, "public"));

    const previousCwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "limacina-panel-cwd-")));
    try {
      const service = new TechnicalPanelDeployService();
      expect(service["repoDir"]).toBe(DEFAULT_PANEL_REPO_DIR);
      expect(service["publicDir"]).toBe(DEFAULT_PANEL_PUBLIC_DIR);
    } finally {
      process.chdir(previousCwd);
    }
  });

  describe("swapPanelDirectory", (): void => {
    it("подменяет каталог панели содержимым сборки", (): void => {
      const publicDir = makeWorkDir();
      mkdirSync(join(publicDir, PANEL_DIR_NAME), { recursive: true });
      writeFileSync(join(publicDir, PANEL_DIR_NAME, "index.html"), "panel-old");
      const holder = makeWorkDir();
      const buildOutputDir = join(holder, "public");
      mkdirSync(buildOutputDir, { recursive: true });
      writeFileSync(join(buildOutputDir, "index.html"), "panel-new");

      swapPanelDirectory(logger, publicDir, buildOutputDir);

      expect(panelContent(publicDir)).toBe("panel-new");
      expect(backupEntries(publicDir)).toHaveLength(0);
      expect(existsSync(buildOutputDir)).toBe(false);
    });

    it("откатывает панель из резервной копии при сбое подмены", (): void => {
      if (!canTestPermissions()) return;
      const publicDir = makeWorkDir();
      mkdirSync(join(publicDir, PANEL_DIR_NAME), { recursive: true });
      writeFileSync(join(publicDir, PANEL_DIR_NAME, "index.html"), "panel-old");
      const holder = makeWorkDir();
      const buildOutputDir = join(holder, "public");
      mkdirSync(buildOutputDir, { recursive: true });
      writeFileSync(join(buildOutputDir, "index.html"), "panel-new");
      chmodSync(holder, 0o555);

      try {
        expect(() => swapPanelDirectory(logger, publicDir, buildOutputDir)).toThrow();
        expect(panelContent(publicDir)).toBe("panel-old");
        expect(backupEntries(publicDir)).toHaveLength(0);
      } finally {
        chmodSync(holder, 0o755);
      }
    });

    it("не трогает панель при сбое создания резервной копии", (): void => {
      if (!canTestPermissions()) return;
      const publicDir = makeWorkDir();
      mkdirSync(join(publicDir, PANEL_DIR_NAME), { recursive: true });
      writeFileSync(join(publicDir, PANEL_DIR_NAME, "index.html"), "panel-old");
      const holder = makeWorkDir();
      const buildOutputDir = join(holder, "public");
      mkdirSync(buildOutputDir, { recursive: true });
      writeFileSync(join(buildOutputDir, "index.html"), "panel-new");
      chmodSync(publicDir, 0o555);

      try {
        expect(() => swapPanelDirectory(logger, publicDir, buildOutputDir)).toThrow();
        expect(panelContent(publicDir)).toBe("panel-old");
        expect(backupEntries(publicDir)).toHaveLength(0);
      } finally {
        chmodSync(publicDir, 0o755);
      }
    });
  });

  describe("runPanelStep", (): void => {
    it("выполняет успешный шаг", async (): Promise<void> => {
      await runPanelStep(logger, "version", ["bun", "--version"], 30_000, process.cwd());
    });

    it("бросает ошибку шага при ненулевом коде выхода", async (): Promise<void> => {
      await expect(
        runPanelStep(logger, "bun-fail", ["bun", "-e", "process.exit(3)"], 30_000, process.cwd()),
      ).rejects.toThrow("bun-fail");
    });

    it("бросает ошибку таймаута на зависшем шаге", async (): Promise<void> => {
      await expect(
        runPanelStep(
          logger,
          "bun-hang",
          ["bun", "-e", "await Bun.sleep(30_000)"],
          300,
          process.cwd(),
        ),
      ).rejects.toThrow(/таймаут/);
    }, 10_000);

    it("бросает ошибку при отсутствии команды", async (): Promise<void> => {
      await expect(
        runPanelStep(logger, "missing", ["limacina-missing-cmd-xyz"], 5_000, process.cwd()),
      ).rejects.toThrow("не запущена");
    });
  });

  it("деплой отклоняет чекаут с чужим origin до fetch и checkout", async (): Promise<void> => {
    const { publicDir } = createService(panelFixture);
    await new TechnicalPanelDeployService({
      repoUrl: panelFixture,
      repoDir: makeWorkDir(),
      publicDir,
    }).deploy();
    const foreignRepoDir = makeWorkDir();
    git(["clone", panelFixture, foreignRepoDir], fixtureRoot);
    const { service } = createService("https://example.invalid/limacina-panel.git", {
      repoDir: foreignRepoDir,
      publicDir,
    });

    await expect(service.deploy()).rejects.toThrow("чужой репозиторий");

    expect(existsSync(join(foreignRepoDir, ".git"))).toBe(true);
    expect(panelContent(publicDir)).toBe("panel-v2");
  }, 30_000);

  describe("лок деплоя панели", (): void => {
    it("второй параллельный deploy отклоняется локом и не трогает repoDir и панель", async (): Promise<void> => {
      const repoDir = makeWorkDir();
      const publicDir = makeWorkDir();
      const token = await acquirePanelDeployLock(repoDir, 100, logger);
      try {
        const service = new TechnicalPanelDeployService({
          repoUrl: panelFixture,
          repoDir,
          publicDir,
          lockTimeoutMs: 250,
        });

        await expect(service.deploy()).rejects.toThrow("уже выполняется");

        expect(existsSync(join(repoDir, ".git"))).toBe(false);
        expect(existsSync(join(publicDir, PANEL_DIR_NAME))).toBe(false);
      } finally {
        releasePanelDeployLock(repoDir, token, logger);
      }

      const retry = new TechnicalPanelDeployService({
        repoUrl: panelFixture,
        repoDir,
        publicDir,
        lockTimeoutMs: 250,
      });
      expect((await retry.deploy()).ref).toBe("main");
      expect(panelContent(publicDir)).toBe("panel-v2");
    }, 30_000);

    it("лок снимается после аварийного завершения деплоя", async (): Promise<void> => {
      const repoDir = makeWorkDir();
      const publicDir = makeWorkDir();
      const service = new TechnicalPanelDeployService({
        repoUrl: failingFixture,
        repoDir,
        publicDir,
        lockTimeoutMs: 250,
      });

      await expect(service.deploy()).rejects.toThrow("bun run build");

      expect(existsSync(buildPanelDeployLockPath(repoDir))).toBe(false);

      const retry = new TechnicalPanelDeployService({
        repoUrl: failingFixture,
        repoDir,
        publicDir,
        lockTimeoutMs: 250,
      });
      await expect(retry.deploy()).rejects.toThrow("bun run build");
      expect(existsSync(buildPanelDeployLockPath(repoDir))).toBe(false);
    }, 30_000);

    it("протухший лок перехватывается, деплой выполняется", async (): Promise<void> => {
      const repoDir = makeWorkDir();
      const publicDir = makeWorkDir();
      await acquirePanelDeployLock(repoDir, 100, logger);
      const lockPath = buildPanelDeployLockPath(repoDir);
      const past = new Date(Date.now() - PANEL_DEPLOY_LOCK_STALE_MS - 60_000);
      utimesSync(lockPath, past, past);

      const service = new TechnicalPanelDeployService({
        repoUrl: panelFixture,
        repoDir,
        publicDir,
        lockTimeoutMs: 2_000,
      });
      const result = await service.deploy();

      expect(result.ref).toBe("main");
      expect(panelContent(publicDir)).toBe("panel-v2");
      expect(existsSync(lockPath)).toBe(false);
    }, 30_000);
  });

  describe("resolveDefaultBranch", (): void => {
    it("возвращает ветку по умолчанию из origin/HEAD", async (): Promise<void> => {
      const cloneDir = makeWorkDir();
      git(["clone", panelFixture, join(cloneDir, "checkout")], cloneDir);

      expect(await resolveDefaultBranch(logger, join(cloneDir, "checkout"))).toBe("main");
    });

    it("возвращает main вне git-репозитория", async (): Promise<void> => {
      expect(await resolveDefaultBranch(logger, makeWorkDir())).toBe("main");
    });

    it("возвращает main без origin/HEAD", async (): Promise<void> => {
      const bareDir = makeWorkDir();
      git(["init", "-b", "main", join(bareDir, "repo")], bareDir);

      expect(await resolveDefaultBranch(logger, join(bareDir, "repo"))).toBe("main");
    });
  });
});

describe("panel-deploy-dirs — имена резервных копий", (): void => {
  it("формирует и распознаёт dot-имя резервной копии", (): void => {
    const name = buildPanelBackupName("abc-123");
    expect(name.startsWith(".panel.old-")).toBe(true);
    expect(isPanelBackupEntry(name)).toBe(true);
    expect(isPanelBackupEntry("panel")).toBe(false);
    expect(isPanelBackupEntry(".staging-abc")).toBe(false);
    expect(isPanelBackupEntry(".panel.oldx")).toBe(false);
    expect(isPanelBackupEntry(".panel")).toBe(false);
  });
});
