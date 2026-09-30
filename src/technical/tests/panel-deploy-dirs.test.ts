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

  it("при нескольких бэкапах восстанавливает ровно один и не создаёт панель повторно", (): void => {
    const publicDir = makeWorkDir();
    makeBackup(publicDir, "panel-first");
    makeBackup(publicDir, "panel-second");

    recoverPanelBackups(publicDir, logger);

    expect(["panel-first", "panel-second"]).toContain(
      readPanelIndex(join(publicDir, PANEL_DIR_NAME)),
    );
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

  it("переживает отсутствие каталога public", (): void => {
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

  it("переживает отсутствие каталога public", (): void => {
    expect(() => cleanupPanelBackups(join(makeWorkDir(), "absent"), logger)).not.toThrow();
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
