import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import {
  DEFAULT_PANEL_REPO_DIR,
  PANEL_DIR_NAME,
  buildPanelBackupName,
  cleanupPanelBackups,
  moveDirectory,
  recoverPanelBackups,
  resolvePanelRepoDir,
} from "../panel-deploy-dirs";

describe("panel-deploy-dirs — свип резервных копий панели", (): void => {
  const logger = new Logger("panel-deploy-dirs");
  const workdirs: string[] = [];

  function makeWorkDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "limacina-panel-dirs-"));
    workdirs.push(dir);
    return dir;
  }

  afterAll((): void => {
    for (const dir of workdirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeBackup(publicDir: string, marker: string): string {
    const backupPath = join(publicDir, buildPanelBackupName(marker));
    mkdirSync(backupPath, { recursive: true });
    writeFileSync(join(backupPath, "index.html"), marker);
    return backupPath;
  }

  it("восстанавливает каталог панели из бэкапа после crash-окна подмены", (): void => {
    const publicDir = makeWorkDir();
    const backupPath = makeBackup(publicDir, "panel-lost");

    recoverPanelBackups(publicDir, logger);

    expect(readPanelIndex(join(publicDir, PANEL_DIR_NAME))).toBe("panel-lost");
    expect(existsSync(backupPath)).toBe(false);
  });

  it("при нескольких бэкапах восстанавливает самый свежий по mtime", (): void => {
    const publicDir = makeWorkDir();
    const older = makeBackup(publicDir, "panel-older");
    const newer = makeBackup(publicDir, "panel-newer");
    utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    utimesSync(newer, new Date(2_000_000), new Date(2_000_000));

    recoverPanelBackups(publicDir, logger);

    expect(readPanelIndex(join(publicDir, PANEL_DIR_NAME))).toBe("panel-newer");
    expect(existsSync(older)).toBe(true);
    expect(readdirNames(publicDir).filter((entry) => entry.startsWith(".panel.old-"))).toHaveLength(
      1,
    );
  });

  it("не трогает бэкапы при живой панели", (): void => {
    const publicDir = makeWorkDir();
    mkdirSync(join(publicDir, PANEL_DIR_NAME), { recursive: true });
    writeFileSync(join(publicDir, PANEL_DIR_NAME, "index.html"), "panel-live");
    const backupPath = makeBackup(publicDir, "panel-stale");

    recoverPanelBackups(publicDir, logger);

    expect(readPanelIndex(join(publicDir, PANEL_DIR_NAME))).toBe("panel-live");
    expect(existsSync(backupPath)).toBe(true);
  });

  it("recoverPanelBackups переживает отсутствие каталога public", (): void => {
    expect(() => recoverPanelBackups(join(makeWorkDir(), "absent"), logger)).not.toThrow();
  });

  it("удаляет бэкапы при живой панели и не трогает остальное", (): void => {
    const publicDir = makeWorkDir();
    mkdirSync(join(publicDir, PANEL_DIR_NAME), { recursive: true });
    writeFileSync(join(publicDir, PANEL_DIR_NAME, "index.html"), "panel-live");
    makeBackup(publicDir, "panel-stale-1");
    makeBackup(publicDir, "panel-stale-2");
    writeFileSync(join(publicDir, "version.json"), "{}");

    cleanupPanelBackups(publicDir, logger);

    expect(readPanelIndex(join(publicDir, PANEL_DIR_NAME))).toBe("panel-live");
    expect(existsSync(join(publicDir, "version.json"))).toBe(true);
    expect(readdirNames(publicDir).filter((entry) => entry.startsWith(".panel.old-"))).toHaveLength(
      0,
    );
  });

  it("оставляет бэкапы при отсутствующей панели — единственную копию", (): void => {
    const publicDir = makeWorkDir();
    const backupPath = makeBackup(publicDir, "panel-only");

    cleanupPanelBackups(publicDir, logger);

    expect(existsSync(backupPath)).toBe(true);
  });

  it("cleanupPanelBackups переживает отсутствие каталога public", (): void => {
    expect(() => cleanupPanelBackups(join(makeWorkDir(), "absent"), logger)).not.toThrow();
  });
});

describe("panel-deploy-dirs — moveDirectory", (): void => {
  function makeSource(root: string): { source: string; content: string } {
    const source = mkdtempSync(join(root, "limacina-move-"));
    const content = "panel-move";
    mkdirSync(join(source, "assets"), { recursive: true });
    writeFileSync(join(source, "index.html"), content);
    writeFileSync(join(source, "assets", "app.js"), "js");
    return { source, content };
  }

  function makeTarget(): string {
    return join(mkdtempSync(join(tmpdir(), "limacina-move-target-")), "panel");
  }

  it("переименовывает каталог внутри одной файловой системы", (): void => {
    const { source, content } = makeSource(tmpdir());
    const target = makeTarget();

    moveDirectory(source, target);

    expect(readFileSync(join(target, "index.html"), "utf-8")).toBe(content);
    expect(readFileSync(join(target, "assets", "app.js"), "utf-8")).toBe("js");
    expect(existsSync(source)).toBe(false);
  });

  it("переносит каталог на другую файловую систему через копирование (EXDEV)", (): void => {
    const shmRoot = "/dev/shm";
    if (!existsSync(shmRoot) || statSync(shmRoot).dev === statSync(tmpdir()).dev) return;
    const { source, content } = makeSource(shmRoot);
    const target = makeTarget();

    moveDirectory(source, target);

    expect(readFileSync(join(target, "index.html"), "utf-8")).toBe(content);
    expect(readFileSync(join(target, "assets", "app.js"), "utf-8")).toBe("js");
    expect(existsSync(source)).toBe(false);
  });

  it("пробрасывает ошибку, не связанную с EXDEV", (): void => {
    const { source } = makeSource(tmpdir());
    const missingParent = join(makeTarget(), "absent", "panel");

    expect(() => moveDirectory(source, missingParent)).toThrow();
  });
});

describe("panel-deploy-dirs — resolvePanelRepoDir", (): void => {
  it("пустое и пробельное значение PANEL_REPO_DIR даёт дефолтный каталог чекаута", (): void => {
    expect(resolvePanelRepoDir(undefined)).toBe(DEFAULT_PANEL_REPO_DIR);
    expect(resolvePanelRepoDir("")).toBe(DEFAULT_PANEL_REPO_DIR);
    expect(resolvePanelRepoDir("   ")).toBe(DEFAULT_PANEL_REPO_DIR);
  });

  it("непустое значение используется как есть", (): void => {
    expect(resolvePanelRepoDir("/srv/panel-checkout")).toBe("/srv/panel-checkout");
  });
});

function readPanelIndex(panelDir: string): string {
  return readFileSync(join(panelDir, "index.html"), "utf-8").trim();
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir);
}
