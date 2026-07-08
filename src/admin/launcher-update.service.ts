import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

const PUBLIC_DIR = "public";
const VERSION_FILE = join(PUBLIC_DIR, "version.json");

const SUPPORTED_PLATFORMS: Record<string, string[]> = {
  linux: ["x86_64", "aarch64"],
  windows: ["x86_64"],
};

const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

interface VersionData {
  version: string;
}

interface PlatformFile {
  os: string;
  arch: string;
  buffer: Buffer;
}

@Injectable()
export class LauncherUpdateService {
  private readonly logger = new Logger(LauncherUpdateService.name);

  update(version: string, files: PlatformFile[]): { version: string; updated: string[] } {
    this.validateVersion(version);
    this.writeVersion(version);

    const updated: string[] = [];
    for (const file of files) {
      this.replaceZip(version, file.os, file.arch, file.buffer);
      updated.push(`${file.os}/${file.arch}`);
    }

    this.logger.log({ version, platforms: updated }, "Лаунчер обновлён");

    return { version, updated };
  }

  private validateVersion(version: string): void {
    if (!VERSION_REGEX.test(version)) {
      throw new BadRequestException("Версия должна быть в формате x.x.x (например 1.2.3)");
    }
  }

  private writeVersion(version: string): void {
    const data: VersionData = { version };
    writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + "\n");
  }

  private replaceZip(version: string, os: string, arch: string, buffer: Buffer): void {
    const platform = SUPPORTED_PLATFORMS[os];
    if (!platform || !platform.includes(arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }

    const dir = join(PUBLIC_DIR, os, arch);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const existing = readdirSync(dir).filter((f) => f.endsWith(".zip"));
    for (const old of existing) {
      unlinkSync(join(dir, old));
    }

    const filename = `Limacina-${version}-${os}-${arch}.zip`;
    writeFileSync(join(dir, filename), new Uint8Array(buffer));
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
