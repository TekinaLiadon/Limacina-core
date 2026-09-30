import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type { LauncherReleaseResponseDto } from "./dto/dto";
import { removeFilesQuietly } from "../utils/fs";
import {
  PUBLIC_DIR,
  RELEASES_DIR,
  buildUpdaterArtifactName,
  findUpdaterPlatform,
  validateLauncherVersion,
} from "./launcher-files";
import {
  RELEASE_LOCK_TOKEN_FILENAME,
  buildReleaseBackupName,
  buildReleaseLockName,
  buildReleaseStagingName,
  buildReleaseStolenLockName,
  cleanupReleaseServiceDirs,
  recoverReleaseBackups,
} from "./release-service-dirs";

const PUBLISH_LOCK_TIMEOUT_MS = 10_000;
const PUBLISH_LOCK_STALE_MS = 5 * 60_000;
const SERVICE_DIR_STALE_MS = 60 * 60_000;

export interface UpdaterArtifactUpload {
  platformKey: string;
  suffix: string;
  artifactTempPath: string;
  signatureTempPath: string;
}

export async function acquirePublishLock(
  releasesRoot: string,
  version: string,
  timeoutMs: number,
  logger: Logger,
): Promise<string> {
  const lockDir = join(releasesRoot, buildReleaseLockName(version));
  const tokenPath = join(lockDir, RELEASE_LOCK_TOKEN_FILENAME);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      mkdirSync(lockDir);
    } catch {
      if (Date.now() > deadline) {
        throw new ConflictException(
          `Публикация версии ${version} уже выполняется, повторите позже`,
        );
      }
      stealStaleLock(releasesRoot, version, lockDir, logger);
      await Bun.sleep(100);
      continue;
    }

    const token = randomUUID();
    writeFileSync(tokenPath, token);
    return token;
  }
}

export function releasePublishLock(
  releasesRoot: string,
  version: string,
  token: string,
  logger: Logger,
): void {
  const lockDir = join(releasesRoot, buildReleaseLockName(version));
  if (readLockToken(lockDir) !== token) {
    logger.warn(
      { lockDir },
      "Лок публикации релиза принадлежит другой публикации — снятие чужого лока отклонено",
    );
    return;
  }

  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch (error) {
    logger.error({ err: error, version }, "Не удалось снять лок публикации релиза");
  }
}

export function ensurePublishLockOwned(releasesRoot: string, version: string, token: string): void {
  const lockDir = join(releasesRoot, buildReleaseLockName(version));
  if (readLockToken(lockDir) === token) return;

  throw new ConflictException(
    `Публикация версии ${version} прервана: лок публикации перехвачен другой публикацией`,
  );
}

function stealStaleLock(
  releasesRoot: string,
  version: string,
  lockDir: string,
  logger: Logger,
): void {
  let stale = false;
  try {
    stale = Date.now() - statSync(lockDir).mtimeMs > PUBLISH_LOCK_STALE_MS;
  } catch {
    return;
  }
  if (!stale) return;

  const stolenDir = join(releasesRoot, buildReleaseStolenLockName(version, randomUUID()));
  try {
    renameSync(lockDir, stolenDir);
    logger.warn({ lockDir, stolenDir }, "Перехвачен протухший лок публикации релиза");
  } catch (error) {
    logger.warn({ err: error, lockDir }, "Не удалось перехватить протухший лок публикации релиза");
  }
}

function readLockToken(lockDir: string): string | undefined {
  try {
    return readFileSync(join(lockDir, RELEASE_LOCK_TOKEN_FILENAME), "utf-8");
  } catch {
    return undefined;
  }
}

@Injectable()
export class ReleasePublishService {
  private readonly logger = new Logger(ReleasePublishService.name);

  constructor(@Optional() private readonly lockTimeoutMs: number = PUBLISH_LOCK_TIMEOUT_MS) {}

  async publish(
    version: string,
    artifacts: UpdaterArtifactUpload[],
  ): Promise<LauncherReleaseResponseDto> {
    try {
      if (!version) {
        throw new BadRequestException("Не передано поле version");
      }
      validateLauncherVersion(version);
      if (artifacts.length === 0) {
        throw new BadRequestException("Нужен хотя бы один артефакт платформы");
      }
      for (const artifact of artifacts) {
        this.validateArtifactSignature(artifact);
      }

      const releasesRoot = join(PUBLIC_DIR, RELEASES_DIR);
      const releaseDir = join(releasesRoot, version);
      mkdirSync(releasesRoot, { recursive: true });

      const token = await acquirePublishLock(
        releasesRoot,
        version,
        this.lockTimeoutMs,
        this.logger,
      );
      try {
        ensurePublishLockOwned(releasesRoot, version, token);
        const stagingDir = join(releasesRoot, buildReleaseStagingName(randomUUID()));
        try {
          mkdirSync(stagingDir, { recursive: true });
          this.cleanServiceDirs(releasesRoot, version);
          if (existsSync(releaseDir)) {
            this.stageExistingFiles(releaseDir, stagingDir);
          }
          for (const artifact of artifacts) {
            this.commitPlatform(stagingDir, version, artifact);
          }
          ensurePublishLockOwned(releasesRoot, version, token);
          this.swapReleaseDir(releaseDir, stagingDir);
        } catch (error) {
          this.removeDirQuietly(stagingDir);
          throw error;
        }
      } finally {
        releasePublishLock(releasesRoot, version, token, this.logger);
      }

      const published = artifacts.map((artifact) => artifact.platformKey);
      this.logger.log({ version, platforms: published }, "Релиз лаунчера опубликован");
      return { version, published };
    } finally {
      this.removeTempFiles(artifacts);
    }
  }

  private cleanServiceDirs(releasesRoot: string, version: string): void {
    recoverReleaseBackups(releasesRoot, this.logger, version);
    cleanupReleaseServiceDirs(releasesRoot, this.logger, SERVICE_DIR_STALE_MS);
  }

  private stageExistingFiles(releaseDir: string, stagingDir: string): void {
    for (const file of readdirSync(releaseDir)) {
      const source = join(releaseDir, file);
      if (!statSync(source).isFile()) continue;

      const target = join(stagingDir, file);
      try {
        linkSync(source, target);
      } catch {
        copyFileSync(source, target);
      }
    }
  }

  private validateArtifactSignature(artifact: UpdaterArtifactUpload): void {
    let signature: string;
    try {
      signature = readFileSync(artifact.signatureTempPath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Не удалось прочитать подпись платформы ${artifact.platformKey}`,
      );
    }
    if (signature.trim().length === 0) {
      throw new BadRequestException(`Подпись платформы ${artifact.platformKey} пустая`);
    }
  }

  private commitPlatform(
    stagingDir: string,
    version: string,
    artifact: UpdaterArtifactUpload,
  ): void {
    const platform = findUpdaterPlatform(artifact.platformKey);
    if (!platform) {
      throw new BadRequestException(
        `Неподдерживаемая платформа обновления: ${artifact.platformKey}`,
      );
    }

    const artifactName = buildUpdaterArtifactName(version, platform.key, artifact.suffix);
    renameSync(artifact.artifactTempPath, join(stagingDir, artifactName));
    renameSync(artifact.signatureTempPath, join(stagingDir, `${artifactName}.sig`));
  }

  private swapReleaseDir(releaseDir: string, stagingDir: string): void {
    let backupDir: string | undefined;
    if (existsSync(releaseDir)) {
      backupDir = join(
        dirname(releaseDir),
        buildReleaseBackupName(basename(releaseDir), randomUUID()),
      );
      renameSync(releaseDir, backupDir);
    }
    try {
      renameSync(stagingDir, releaseDir);
    } catch (error) {
      if (backupDir) {
        try {
          renameSync(backupDir, releaseDir);
        } catch (restoreError) {
          this.logger.error(
            { err: restoreError, dir: backupDir },
            "Не удалось восстановить каталог релиза после сбоя публикации",
          );
        }
      }
      throw error;
    }
    if (backupDir) {
      this.removeDirQuietly(backupDir);
    }
  }

  private removeDirQuietly(dir: string): void {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      this.logger.error({ err: error, dir }, "Не удалось удалить каталог релиза");
    }
  }

  private removeTempFiles(artifacts: UpdaterArtifactUpload[]): void {
    removeFilesQuietly(
      this.logger,
      artifacts.flatMap((artifact) => [artifact.artifactTempPath, artifact.signatureTempPath]),
      "Не удалось удалить временный файл загрузки релиза",
    );
  }
}
