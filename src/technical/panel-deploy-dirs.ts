import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { PUBLIC_DIR } from "../launcher/launcher-files";

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

  for (const entry of listEntries(publicRoot)) {
    if (!isPanelBackupEntry(entry)) continue;

    const backupPath = join(publicRoot, entry);
    try {
      renameSync(backupPath, panelDir);
      logger.warn(
        { backup: entry, restored: panelDir },
        "Каталог панели восстановлен из резервной копии после сбоя деплоя",
      );
      return;
    } catch (error) {
      logger.error(
        { err: error, backup: backupPath },
        "Не удалось восстановить каталог панели из резервной копии",
      );
    }
  }
}

export function cleanupPanelBackups(publicRoot: string, logger: Logger): void {
  if (!existsSync(join(publicRoot, PANEL_DIR_NAME))) return;

  for (const entry of listEntries(publicRoot)) {
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

function listEntries(publicRoot: string): string[] {
  try {
    return readdirSync(publicRoot);
  } catch {
    return [];
  }
}
