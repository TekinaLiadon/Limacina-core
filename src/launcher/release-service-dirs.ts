import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { LAUNCHER_VERSION_REGEX } from "./launcher-files";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BACKUP_INFIX = ".old-";
const UUID_LENGTH = 36;

export function buildReleaseStagingName(uuid: string): string {
  return `.staging-${uuid}`;
}

export function buildReleaseLockName(version: string): string {
  return `.lock-${version}`;
}

export const RELEASE_LOCK_TOKEN_FILENAME = "owner.token";

const STOLEN_INFIX = ".stolen-";

export function buildReleaseStolenLockName(version: string, uuid: string): string {
  return `${buildReleaseLockName(version)}${STOLEN_INFIX}${uuid}`;
}

export function buildReleaseBackupName(version: string, uuid: string): string {
  return `${BACKUP_INFIX}${version}-${uuid}`;
}

export function buildReplacedZipName(zipName: string): string {
  return `.${zipName}.replaced`;
}

export function isReleaseStagingEntry(entry: string): boolean {
  return entry.startsWith(".staging-");
}

export function isReleaseLockEntry(entry: string): boolean {
  return entry.startsWith(".lock-");
}

export function isReleaseStolenLockEntry(entry: string): boolean {
  const infixIndex = entry.indexOf(STOLEN_INFIX);
  if (!entry.startsWith(".lock-") || infixIndex < 0) return false;
  return UUID_PATTERN.test(entry.slice(infixIndex + STOLEN_INFIX.length));
}

export function isReleaseBackupEntry(entry: string): boolean {
  return entry.includes(BACKUP_INFIX);
}

export function isReleaseServiceEntry(entry: string): boolean {
  return isReleaseStagingEntry(entry) || isReleaseLockEntry(entry) || isReleaseBackupEntry(entry);
}

export function isZipReplacedEntry(entry: string): boolean {
  return entry.endsWith(".replaced");
}

export function parseReleaseBackupEntry(entry: string): string | null {
  if (!entry.startsWith(".")) {
    const separator = entry.indexOf(BACKUP_INFIX);
    if (separator <= 0) return null;
    const base = entry.slice(0, separator);
    return LAUNCHER_VERSION_REGEX.test(base) ? base : null;
  }

  if (!entry.startsWith(BACKUP_INFIX)) return null;
  const rest = entry.slice(BACKUP_INFIX.length);
  const uuidStart = rest.length - UUID_LENGTH;
  if (uuidStart <= 1) return null;
  if (rest[uuidStart - 1] !== "-") return null;

  const base = rest.slice(0, uuidStart - 1);
  const uuid = rest.slice(uuidStart);
  if (!UUID_PATTERN.test(uuid)) return null;
  return LAUNCHER_VERSION_REGEX.test(base) ? base : null;
}

export function recoverReleaseBackups(releasesRoot: string, logger: Logger): void {
  for (const entry of listEntries(releasesRoot)) {
    if (!isReleaseBackupEntry(entry)) continue;

    const base = parseReleaseBackupEntry(entry);
    if (!base || existsSync(join(releasesRoot, base))) continue;

    const backupPath = join(releasesRoot, entry);
    try {
      renameSync(backupPath, join(releasesRoot, base));
      logger.warn(
        { backup: entry, restored: base },
        "Каталог релиза восстановлен из резервной копии после сбоя публикации",
      );
    } catch (error) {
      logger.error(
        { err: error, backup: backupPath },
        "Не удалось восстановить каталог релиза из резервной копии",
      );
    }
  }
}

export function cleanupReleaseServiceDirs(
  releasesRoot: string,
  logger: Logger,
  staleMs?: number,
): void {
  for (const entry of listEntries(releasesRoot)) {
    const restorableBackup =
      isReleaseBackupEntry(entry) &&
      (() => {
        const base = parseReleaseBackupEntry(entry);
        return !!base && !existsSync(join(releasesRoot, base));
      })();
    if (restorableBackup) continue;

    if (!isServiceRemovableEntry(entry)) continue;
    if (staleMs !== undefined && !isEntryStale(join(releasesRoot, entry), staleMs)) continue;

    const fullPath = join(releasesRoot, entry);
    try {
      rmSync(fullPath, { recursive: true, force: true });
      logger.warn({ dir: entry }, "Удалён служебный каталог релизов");
    } catch (error) {
      logger.error({ err: error, dir: fullPath }, "Не удалось удалить служебный каталог релизов");
    }
  }
}

function isServiceRemovableEntry(entry: string): boolean {
  return isReleaseStagingEntry(entry) || isReleaseLockEntry(entry) || isReleaseBackupEntry(entry);
}

function isEntryStale(fullPath: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(fullPath).mtimeMs > staleMs;
  } catch {
    return false;
  }
}

function listEntries(releasesRoot: string): string[] {
  try {
    return readdirSync(releasesRoot);
  } catch {
    return [];
  }
}
