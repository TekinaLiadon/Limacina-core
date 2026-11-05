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
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { PUBLIC_DIR } from "../launcher/launcher-files";
import { listDirEntriesQuietly } from "../utils/fs";

export const PANEL_DIR_NAME = "panel";
export const PANEL_PUBLIC_DIR = join(PUBLIC_DIR, PANEL_DIR_NAME);
export const DEFAULT_PANEL_BRANCH = "main";
export const PANEL_REPO_URL = "https://github.com/TekinaLiadon/Limacina-admin.git";
export const PANEL_SERVICE_DIR_STALE_MS = 30 * 60_000;

export interface PanelBackupSweepOptions {
  freshWindowMs?: number;
}

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
  return resolve(trimmed);
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

const PANEL_MOVE_STAGING_PREFIX = ".panel.move-";

export function buildPanelMoveStagingName(uuid: string): string {
  return `${PANEL_MOVE_STAGING_PREFIX}${uuid}`;
}

export function isPanelMoveStagingEntry(entry: string): boolean {
  return entry.startsWith(PANEL_MOVE_STAGING_PREFIX);
}

export function isPanelServiceEntry(entry: string): boolean {
  return isPanelBackupEntry(entry) || isPanelMoveStagingEntry(entry);
}

export function recoverPanelBackups(
  publicRoot: string,
  logger: Logger,
  options: PanelBackupSweepOptions = {},
): void {
  const panelDir = join(publicRoot, PANEL_DIR_NAME);
  if (existsSync(panelDir)) return;

  const newest = newestPanelBackup(publicRoot);
  if (!newest) return;
  if (isFreshMtime(newest.mtimeMs, options.freshWindowMs)) {
    logger.warn(
      { backup: newest.entry },
      "Восстановление каталога панели отложено: резервная копия создана недавно — возможно, выполняется деплой",
    );
    return;
  }

  const backupPath = join(publicRoot, newest.entry);
  try {
    renameSync(backupPath, panelDir);
    logger.warn(
      { backup: newest.entry, restored: panelDir },
      "Каталог панели восстановлен из резервной копии после сбоя деплоя",
    );
  } catch (error) {
    logger.error(
      { err: error, backup: backupPath },
      "Не удалось восстановить каталог панели из резервной копии",
    );
  }
}

function newestPanelBackup(publicRoot: string): { entry: string; mtimeMs: number } | undefined {
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
  return newest;
}

export function cleanupPanelBackups(
  publicRoot: string,
  logger: Logger,
  options: PanelBackupSweepOptions = {},
): void {
  if (!existsSync(join(publicRoot, PANEL_DIR_NAME))) return;

  for (const entry of listDirEntriesQuietly(publicRoot)) {
    if (!isPanelServiceEntry(entry)) continue;

    const servicePath = join(publicRoot, entry);
    if (isEntryFresh(servicePath, options.freshWindowMs)) continue;

    try {
      rmSync(servicePath, { recursive: true, force: true });
      logger.warn({ dir: entry }, "Удалён служебный каталог деплоя панели");
    } catch (error) {
      logger.error(
        { err: error, dir: servicePath },
        "Не удалось удалить служебный каталог деплоя панели",
      );
    }
  }
}

function isFreshMtime(mtimeMs: number, freshWindowMs: number | undefined): boolean {
  return freshWindowMs !== undefined && Date.now() - mtimeMs < freshWindowMs;
}

function isEntryFresh(fullPath: string, freshWindowMs: number | undefined): boolean {
  try {
    return isFreshMtime(statSync(fullPath).mtimeMs, freshWindowMs);
  } catch {
    return false;
  }
}

export function moveDirectory(source: string, target: string): void {
  try {
    renameSync(source, target);
    return;
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
  }
  const stagingPath = join(dirname(target), buildPanelMoveStagingName(randomUUID()));
  try {
    copyDirectorySync(source, stagingPath);
    renameSync(stagingPath, target);
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
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
