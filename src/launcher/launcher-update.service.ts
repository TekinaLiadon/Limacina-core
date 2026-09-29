import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LauncherUpdateResponseDto } from "./dto/dto";
import { removeFilesQuietly, writeFileAtomicSync } from "../utils/fs";
import {
  LAUNCHER_VERSION_REGEX,
  OLD_VERSIONS_DIR,
  PUBLIC_DIR,
  RESERVED_LAUNCHER_VERSION,
  RESERVED_VERSION_MESSAGE,
  VERSION_FORMAT_MESSAGE,
  buildLauncherZipName,
  isSupportedPlatform,
  parseLauncherZipName,
} from "./launcher-files";
import { buildReplacedZipName } from "./release-service-dirs";
import { VERSION_FILE, readLauncherVersion } from "./version-file";

interface ZipMigrationStep {
  os: string;
  arch: string;
  archived: string[];
  zipFile: string;
  replacedZip?: string;
}

interface VersionData {
  version: string;
}

export interface LauncherPlatformFile {
  os: string;
  arch: string;
  tempPath: string;
}

@Injectable()
export class LauncherUpdateService {
  private readonly logger = new Logger(LauncherUpdateService.name);

  update(version: string, files: LauncherPlatformFile[]): LauncherUpdateResponseDto {
    try {
      if (files.length === 0) {
        throw new BadRequestException("Нужен хотя бы один zip-файл платформы");
      }
      const targetVersion = version || this.requireCurrentVersion();
      this.validateVersion(targetVersion);

      for (const file of files) {
        this.validatePlatform(file.os, file.arch);
      }

      const migration = this.stageNewZips(targetVersion, files);
      try {
        this.commitVersion(targetVersion);
      } catch (error) {
        this.rollbackZips(migration, targetVersion);
        throw error;
      }
      this.discardReplacedBackups(migration);

      const updated = migration.map((step) => `${step.os}/${step.arch}`);
      this.logger.log({ version: targetVersion, platforms: updated }, "Лаунчер обновлён");

      return { version: targetVersion, updated };
    } finally {
      this.removeTempFiles(files);
    }
  }

  private validateVersion(version: string): void {
    if (version === RESERVED_LAUNCHER_VERSION) {
      throw new BadRequestException(RESERVED_VERSION_MESSAGE);
    }
    if (!LAUNCHER_VERSION_REGEX.test(version)) {
      throw new BadRequestException(VERSION_FORMAT_MESSAGE);
    }
  }

  private requireCurrentVersion(): string {
    const current = readLauncherVersion();
    if (!current) {
      throw new BadRequestException(
        "Не удалось определить текущую версию: version.json отсутствует или повреждён — укажите версию явно",
      );
    }
    return current;
  }

  private validatePlatform(os: string, arch: string): void {
    if (!isSupportedPlatform(os, arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }
  }

  private writeVersion(version: string): void {
    const data: VersionData = { version };
    writeFileAtomicSync(VERSION_FILE, `${JSON.stringify(data, null, 2)}\n`);
  }

  private stageNewZips(version: string, files: LauncherPlatformFile[]): ZipMigrationStep[] {
    const migration: ZipMigrationStep[] = [];

    for (const file of files) {
      const dir = join(PUBLIC_DIR, file.os, file.arch);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const step: ZipMigrationStep = {
        os: file.os,
        arch: file.arch,
        archived: [],
        zipFile: buildLauncherZipName(version, file.os, file.arch),
      };
      migration.push(step);

      try {
        this.archiveCurrentZips(step, dir, version);

        const replacedZip = this.replaceExistingZip(dir, step.zipFile);
        if (replacedZip) step.replacedZip = replacedZip;

        renameSync(file.tempPath, join(dir, step.zipFile));
      } catch (error) {
        this.rollbackZips(migration, version);
        throw error;
      }
    }

    return migration;
  }

  private replaceExistingZip(dir: string, filename: string): string | undefined {
    const targetPath = join(dir, filename);
    if (!existsSync(targetPath)) return undefined;

    const backupPath = join(dir, buildReplacedZipName(filename));
    if (existsSync(backupPath)) unlinkSync(backupPath);
    renameSync(targetPath, backupPath);
    return buildReplacedZipName(filename);
  }

  private discardReplacedBackups(migration: ZipMigrationStep[]): void {
    for (const step of migration) {
      if (!step.replacedZip) continue;

      const backupPath = join(PUBLIC_DIR, step.os, step.arch, step.replacedZip);
      try {
        if (existsSync(backupPath)) unlinkSync(backupPath);
      } catch (error) {
        this.logger.error(
          { err: error, file: backupPath },
          "Не удалось удалить резервную копию перезаписанного zip лаунчера",
        );
      }
    }
  }

  private removeTempFiles(files: LauncherPlatformFile[]): void {
    removeFilesQuietly(
      this.logger,
      files.map((file) => file.tempPath),
      "Не удалось удалить временный файл загрузки лаунчера",
    );
  }

  private rollbackZips(migration: ZipMigrationStep[], version: string): void {
    for (const step of migration) {
      const dir = join(PUBLIC_DIR, step.os, step.arch);
      const oldDir = join(dir, OLD_VERSIONS_DIR);
      const zipPath = join(dir, step.zipFile);

      try {
        if (existsSync(zipPath)) unlinkSync(zipPath);
        if (step.replacedZip) {
          const backupPath = join(dir, step.replacedZip);
          if (existsSync(backupPath)) renameSync(backupPath, zipPath);
        }
        for (const file of step.archived) {
          const archivedPath = join(oldDir, file);
          if (existsSync(archivedPath)) renameSync(archivedPath, join(dir, file));
        }
      } catch (error) {
        this.logger.error(
          { err: error, os: step.os, arch: step.arch, version },
          "Не удалось откатить файлы лаунчера после сбоя обновления",
        );
      }
    }
  }

  private commitVersion(version: string): void {
    this.writeVersion(version);
  }

  private archiveCurrentZips(step: ZipMigrationStep, dir: string, newVersion: string): void {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".zip")) continue;

      const fileVersion = parseLauncherZipName(file, step.os, step.arch);
      if (fileVersion === newVersion) continue;

      this.moveZipToArchive(dir, file);
      step.archived.push(file);
    }
  }

  private moveZipToArchive(dir: string, file: string): void {
    const oldDir = join(dir, OLD_VERSIONS_DIR);
    if (!existsSync(oldDir)) mkdirSync(oldDir, { recursive: true });

    const targetPath = join(oldDir, file);
    if (existsSync(targetPath)) unlinkSync(targetPath);
    renameSync(join(dir, file), targetPath);

    this.logger.log({ file }, "Старая версия лаунчера перенесена в архив");
  }
}
