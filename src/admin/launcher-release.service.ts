import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type { LauncherReleaseResponseDto } from "./dto/dto";
import {
  LAUNCHER_VERSION_REGEX,
  PUBLIC_DIR,
  RELEASES_DIR,
  VERSION_FORMAT_MESSAGE,
  buildUpdaterArtifactName,
  findUpdaterPlatform,
} from "../launcher/launcher-files";

const PUBLISH_LOCK_TIMEOUT_MS = 10_000;
const PUBLISH_LOCK_STALE_MS = 5 * 60_000;
const SERVICE_DIR_STALE_MS = 60 * 60_000;

export interface UpdaterArtifactUpload {
  platformKey: string;
  suffix: string;
  artifactTempPath: string;
  signatureTempPath: string;
}

@Injectable()
export class LauncherReleaseService {
  private readonly logger = new Logger(LauncherReleaseService.name);

  constructor(@Optional() private readonly lockTimeoutMs: number = PUBLISH_LOCK_TIMEOUT_MS) {}

  async publish(
    version: string,
    artifacts: UpdaterArtifactUpload[],
  ): Promise<LauncherReleaseResponseDto> {
    try {
      if (!version) {
        throw new BadRequestException("Не передано поле version");
      }
      if (!LAUNCHER_VERSION_REGEX.test(version)) {
        throw new BadRequestException(VERSION_FORMAT_MESSAGE);
      }
      if (artifacts.length === 0) {
        throw new BadRequestException("Нужен хотя бы один артефакт платформы");
      }

      const releasesRoot = join(PUBLIC_DIR, RELEASES_DIR);
      const releaseDir = join(releasesRoot, version);
      mkdirSync(releasesRoot, { recursive: true });

      await this.acquirePublishLock(version);
      const stagingDir = join(releasesRoot, `.staging-${randomUUID()}`);
      try {
        mkdirSync(stagingDir, { recursive: true });
        this.cleanStaleServiceDirs(releasesRoot);
        if (existsSync(releaseDir)) {
          this.stageExistingFiles(releaseDir, stagingDir);
        }
        for (const artifact of artifacts) {
          this.commitPlatform(stagingDir, version, artifact);
        }
        this.swapReleaseDir(releaseDir, stagingDir);
      } catch (error) {
        this.removeDirQuietly(stagingDir);
        throw error;
      } finally {
        this.releasePublishLock(version);
      }

      const published = artifacts.map((artifact) => artifact.platformKey);
      this.logger.log({ version, platforms: published }, "Релиз лаунчера опубликован");
      return { version, published };
    } finally {
      this.removeTempFiles(artifacts);
    }
  }

  private lockDir(version: string): string {
    return join(PUBLIC_DIR, RELEASES_DIR, `.lock-${version}`);
  }

  private async acquirePublishLock(version: string): Promise<void> {
    const lockDir = this.lockDir(version);
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      try {
        mkdirSync(lockDir);
        return;
      } catch {
        let stale = false;
        try {
          stale = Date.now() - statSync(lockDir).mtimeMs > PUBLISH_LOCK_STALE_MS;
        } catch {
          stale = false;
        }
        if (stale) {
          this.logger.warn({ lockDir }, "Захвачен протухший лок публикации релиза");
          this.releasePublishLock(version);
          continue;
        }
        if (Date.now() > deadline) {
          throw new ConflictException(
            `Публикация версии ${version} уже выполняется, повторите позже`,
          );
        }
        await Bun.sleep(100);
      }
    }
  }

  private releasePublishLock(version: string): void {
    try {
      rmSync(this.lockDir(version), { recursive: true, force: true });
    } catch (error) {
      this.logger.error({ err: error, version }, "Не удалось снять лок публикации релиза");
    }
  }

  private cleanStaleServiceDirs(releasesRoot: string): void {
    let entries: string[];
    try {
      entries = readdirSync(releasesRoot);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.startsWith(".staging-") && !entry.includes(".old-")) continue;
      const fullPath = join(releasesRoot, entry);
      try {
        if (Date.now() - statSync(fullPath).mtimeMs > SERVICE_DIR_STALE_MS) {
          this.logger.warn({ dir: entry }, "Удалён протухший служебный каталог публикации");
          this.removeDirQuietly(fullPath);
        }
      } catch {
        continue;
      }
    }
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
      backupDir = `${releaseDir}.old-${randomUUID()}`;
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
    for (const artifact of artifacts) {
      for (const tempPath of [artifact.artifactTempPath, artifact.signatureTempPath]) {
        try {
          if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch (error) {
          this.logger.error(
            { err: error, path: tempPath },
            "Не удалось удалить временный файл загрузки релиза",
          );
        }
      }
    }
  }
}
