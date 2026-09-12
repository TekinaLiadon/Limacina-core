import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { LauncherUpdateResponseDto } from "./dto/dto";
import {
  LAUNCHER_VERSION_REGEX,
  OLD_VERSIONS_DIR,
  buildLauncherZipName,
  isSupportedPlatform,
  parseLauncherZipName,
} from "../launcher/launcher-files";

const PUBLIC_DIR = "public";
const VERSION_FILE = join(PUBLIC_DIR, "version.json");

interface VersionData {
  version: string;
}

export interface LauncherPlatformFile {
  os: string;
  arch: string;
  buffer: Buffer;
}

@Injectable()
export class LauncherUpdateService {
  private readonly logger = new Logger(LauncherUpdateService.name);

  update(version: string, files: LauncherPlatformFile[]): LauncherUpdateResponseDto {
    const targetVersion = version || this.getCurrentVersion();
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

    const updated = migration.map((step) => `${step.os}/${step.arch}`);
    this.logger.log({ version: targetVersion, platforms: updated }, "Лаунчер обновлён");

    return { version: targetVersion, updated };
  }

  private validateVersion(version: string): void {
    if (!LAUNCHER_VERSION_REGEX.test(version)) {
      throw new BadRequestException("Версия должна быть в формате x.x.x (например 1.2.3)");
    }
  }

  private validatePlatform(os: string, arch: string): void {
    if (!isSupportedPlatform(os, arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }
  }

  private writeVersion(version: string): void {
    const data: VersionData = { version };
    const tmpPath = `${VERSION_FILE}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmpPath, VERSION_FILE);
  }

  private stageNewZips(
    version: string,
    files: LauncherPlatformFile[],
  ): Array<{ os: string; arch: string; archived: string[]; zipFile: string }> {
    const migration: Array<{ os: string; arch: string; archived: string[]; zipFile: string }> = [];

    for (const file of files) {
      const dir = join(PUBLIC_DIR, file.os, file.arch);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const archived = this.archiveCurrentZips(dir, file.os, file.arch, version);

      const filename = buildLauncherZipName(version, file.os, file.arch);
      writeFileSync(join(dir, filename), new Uint8Array(file.buffer));

      migration.push({ os: file.os, arch: file.arch, archived, zipFile: filename });
    }

    return migration;
  }

  private rollbackZips(
    migration: Array<{ os: string; arch: string; archived: string[]; zipFile: string }>,
    version: string,
  ): void {
    for (const step of migration) {
      const dir = join(PUBLIC_DIR, step.os, step.arch);
      const oldDir = join(dir, OLD_VERSIONS_DIR);

      try {
        unlinkSync(join(dir, step.zipFile));
        for (const file of step.archived) {
          renameSync(join(oldDir, file), join(dir, file));
        }
      } catch (error) {
        this.logger.error(
          { err: error, os: step.os, arch: step.arch, version },
          "Не удалось откатить файлы лаунчера после сбоя записи version.json",
        );
      }
    }
  }

  private commitVersion(version: string): void {
    this.writeVersion(version);
  }

  private archiveCurrentZips(dir: string, os: string, arch: string, newVersion: string): string[] {
    const archived: string[] = [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".zip")) continue;

      const fileVersion = parseLauncherZipName(file, os, arch);
      if (fileVersion === newVersion) {
        unlinkSync(join(dir, file));
        continue;
      }

      this.moveZipToArchive(dir, file);
      archived.push(file);
    }

    return archived;
  }

  private moveZipToArchive(dir: string, file: string): void {
    const oldDir = join(dir, OLD_VERSIONS_DIR);
    if (!existsSync(oldDir)) mkdirSync(oldDir, { recursive: true });

    const targetPath = join(oldDir, file);
    if (existsSync(targetPath)) unlinkSync(targetPath);
    renameSync(join(dir, file), targetPath);

    this.logger.log({ file }, "Старая версия лаунчера перенесена в архив");
  }

  getCurrentVersion(): string {
    try {
      const data: VersionData = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
      return data.version;
    } catch {
      return "0.0.0";
    }
  }
}
