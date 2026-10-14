import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { PUBLIC_DIR } from "../launcher/launcher-files";
import { listDirEntriesQuietly } from "../utils/fs";

export const PANEL_DIR_NAME = "panel";
export const PANEL_PUBLIC_DIR = join(PUBLIC_DIR, PANEL_DIR_NAME);
export const DEFAULT_PANEL_BRANCH = "main";
export const PANEL_REPO_URL = "https://github.com/TekinaLiadon/Limacina-admin.git";

const MODULE_PROJECT_ROOT = resolve(import.meta.dir, "../..");

function resolveProjectRoot(): string {
  if (existsSync(join(MODULE_PROJECT_ROOT, "package.json"))) return MODULE_PROJECT_ROOT;
  return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot();
export const DEFAULT_PANEL_REPO_DIR = join(PROJECT_ROOT, "tmp", "panel-admin");
export const DEFAULT_PANEL_PUBLIC_DIR = join(PROJECT_ROOT, PUBLIC_DIR);

export function resolvePanelRepoDir(envValue: string | undefined): string {
  const trimmed = envValue?.trim();
  if (!trimmed) return DEFAULT_PANEL_REPO_DIR;
  return trimmed;
}

const PANEL_DEPLOY_LOCK_PREFIX = ".panel-deploy-lock-";
export const PANEL_DEPLOY_LOCK_TOKEN_FILENAME = "owner.token";

export function buildPanelDeployLockName(repoDirName: string): string {
  return `${PANEL_DEPLOY_LOCK_PREFIX}${repoDirName}`;
}

export function buildPanelDeployLockPath(repoDir: string): string {
  return join(dirname(repoDir), buildPanelDeployLockName(basename(repoDir)));
}

const PANEL_BACKUP_PREFIX = ".panel.old-";

export function buildPanelBackupName(uuid: string): string {
  return `${PANEL_BACKUP_PREFIX}${uuid}`;
}

export function isPanelBackupEntry(entry: string): boolean {
  return entry.startsWith(PANEL_BACKUP_PREFIX);
}

export function recoverPanelBackups(publicRoot: string, logger: Logger): void {
  const panelDir = join(publicRoot, PANEL_DIR_NAME);
  if (existsSync(panelDir)) return;

  const entry = newestPanelBackupEntry(publicRoot);
  if (!entry) return;

  const backupPath = join(publicRoot, entry);
  try {
    renameSync(backupPath, panelDir);
    logger.warn(
      { backup: entry, restored: panelDir },
      "Каталог панели восстановлен из резервной копии после сбоя деплоя",
    );
  } catch (error) {
    logger.error(
      { err: error, backup: backupPath },
      "Не удалось восстановить каталог панели из резервной копии",
    );
  }
}

function newestPanelBackupEntry(publicRoot: string): string | undefined {
  let newest: { entry: string; mtimeMs: number } | undefined;
  for (const entry of listDirEntriesQuietly(publicRoot)) {
    if (!isPanelBackupEntry(entry)) continue;
    let stat: Stats;
    try {
      stat = statSync(join(publicRoot, entry));
    } catch {
      continue;
    }
    if (newest === undefined || stat.mtimeMs > newest.mtimeMs) {
      newest = { entry, mtimeMs: stat.mtimeMs };
    }
  }
  return newest?.entry;
}

export function cleanupPanelBackups(publicRoot: string, logger: Logger): void {
  if (!existsSync(join(publicRoot, PANEL_DIR_NAME))) return;

  for (const entry of listDirEntriesQuietly(publicRoot)) {
    if (!isPanelBackupEntry(entry)) continue;

    const backupPath = join(publicRoot, entry);
    try {
      rmSync(backupPath, { recursive: true, force: true });
      logger.warn({ dir: entry }, "Удалён служебный каталог деплоя панели");
    } catch (error) {
      logger.error(
        { err: error, dir: backupPath },
        "Не удалось удалить служебный каталог деплоя панели",
      );
    }
  }
}

export function moveDirectory(source: string, target: string): void {
  try {
    renameSync(source, target);
    return;
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }
  copyDirectorySync(source, target);
  rmSync(source, { recursive: true, force: true });
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EXDEV"
  );
}

function copyDirectorySync(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const entryPath = join(source, entry.name);
    const entryTarget = join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectorySync(entryPath, entryTarget);
      continue;
    }
    copyFileSync(entryPath, entryTarget);
  }
}
