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
  SUPPORTED_PLATFORMS,
  buildLauncherZipName,
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
    this.writeVersion(targetVersion);

    const updated: string[] = [];
    for (const file of files) {
      this.replaceZip(targetVersion, file.os, file.arch, file.buffer);
      updated.push(`${file.os}/${file.arch}`);
    }

    this.logger.log({ version: targetVersion, platforms: updated }, "Лаунчер обновлён");

    return { version: targetVersion, updated };
  }

  private validateVersion(version: string): void {
    if (!LAUNCHER_VERSION_REGEX.test(version)) {
      throw new BadRequestException("Версия должна быть в формате x.x.x (например 1.2.3)");
    }
  }

  private writeVersion(version: string): void {
    const data: VersionData = { version };
    writeFileSync(VERSION_FILE, `${JSON.stringify(data, null, 2)}\n`);
  }

  private replaceZip(version: string, os: string, arch: string, buffer: Buffer): void {
    const platform = SUPPORTED_PLATFORMS[os];
    if (!platform || !platform.includes(arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }

    const dir = join(PUBLIC_DIR, os, arch);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.archiveCurrentZips(dir, os, arch, version);

    const filename = buildLauncherZipName(version, os, arch);
    writeFileSync(join(dir, filename), new Uint8Array(buffer));
  }

  private archiveCurrentZips(dir: string, os: string, arch: string, newVersion: string): void {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".zip")) continue;

      const fileVersion = parseLauncherZipName(file, os, arch);
      if (fileVersion === newVersion) {
        unlinkSync(join(dir, file));
        continue;
      }

      this.moveZipToArchive(dir, file);
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

  getCurrentVersion(): string {
    try {
      const data: VersionData = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
      return data.version;
    } catch {
      return "0.0.0";
    }
  }
}
