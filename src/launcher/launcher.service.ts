import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";

const PUBLIC_DIR = "public";
const VERSION_FILE = join(PUBLIC_DIR, "version.json");

const SUPPORTED_PLATFORMS: Record<string, string[]> = {
  linux: ["x86_64", "aarch64"],
  windows: ["x86_64"],
};

interface VersionData {
  version: string;
}

interface PlatformInfo {
  os: string;
  arch: string;
}

@Injectable()
export class LauncherService {
  private readonly logger = new Logger(LauncherService.name);

  private version: string = "";
  private platforms: PlatformInfo[] = [];

  async onApplicationBootstrap() {
    this.loadVersion();
    this.scanPlatforms();

    this.logger.log(
      { version: this.version, platforms: this.platforms.length },
      "Лаунчер проиндексирован",
    );
  }

  private loadVersion(): void {
    try {
      const data: VersionData = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
      this.version = data.version;
      this.logger.log({ version: this.version }, "Версия лаунчера загружена");
    } catch {
      this.logger.error("Ошибка чтения version.json");
      this.version = "0.0.0";
    }
  }

  private scanPlatforms(): void {
    this.platforms = [];

    for (const [os, archs] of Object.entries(SUPPORTED_PLATFORMS)) {
      for (const arch of archs) {
        const dir = join(PUBLIC_DIR, os, arch);
        if (!existsSync(dir)) continue;

        const files = readdirSync(dir);
        if (files.some((f) => f.endsWith(".zip"))) {
          this.platforms.push({ os, arch });
        }
      }
    }

    this.logger.log({ platforms: this.platforms }, "Доступные платформы");
  }

  getVersion(): { version: string; platforms: PlatformInfo[] } {
    return { version: this.version, platforms: this.platforms };
  }

  async download(os: string, arch: string, reply: FastifyReply): Promise<void> {
    const platform = SUPPORTED_PLATFORMS[os];
    if (!platform || !platform.includes(arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }

    const dir = join(PUBLIC_DIR, os, arch);
    if (!existsSync(dir)) {
      throw new BadRequestException(`Платформа не найдена: ${os}/${arch}`);
    }

    const files = readdirSync(dir);
    const zipFile = files.find((f) => f.endsWith(".zip"));

    if (!zipFile) {
      throw new BadRequestException(`Файл лаунчера не найден для ${os}/${arch}`);
    }

    const filePath = join(dir, zipFile);
    const file = Bun.file(filePath);

    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${zipFile}"`);
    reply.header("Content-Length", (await file.size).toString());
    reply.send(file.stream());
  }
}
