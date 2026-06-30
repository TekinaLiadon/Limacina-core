import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from "@nestjs/common";
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
export class LauncherService implements OnModuleDestroy {
  private readonly logger = new Logger(LauncherService.name);

  private version = "0.0.0";
  private platforms: PlatformInfo[] = [];
  private versionWatcher?: FSWatcher;

  async onApplicationBootstrap() {
    this.loadVersion();
    this.watchVersion();
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
    } catch {
      this.logger.warn("Ошибка чтения version.json, используется 0.0.0");
      this.version = "0.0.0";
    }
  }

  private watchVersion(): void {
    this.versionWatcher = watch(VERSION_FILE, () => {
      this.loadVersion();
      this.logger.log({ version: this.version }, "Версия лаунчера обновлена");
    });
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

  onModuleDestroy(): void {
    this.versionWatcher?.close();
  }

  async download(os: string, arch: string, reply: FastifyReply): Promise<void> {
    const platform = SUPPORTED_PLATFORMS[os];
    if (!platform || !platform.includes(arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }

    const dir = join(PUBLIC_DIR, os, arch);
    if (!existsSync(dir)) {
      throw new NotFoundException(`Платформа не найдена: ${os}/${arch}`);
    }

    const files = readdirSync(dir);
    const zipFile = files.find((f) => f.endsWith(".zip"));

    if (!zipFile) {
      throw new NotFoundException(`Файл лаунчера не найден для ${os}/${arch}`);
    }

    const filePath = join(dir, zipFile);
    const file = Bun.file(filePath);

    reply.raw.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFile}"`,
      "Content-Length": (await file.size).toString(),
    });

    const buffer = await file.arrayBuffer();
    reply.raw.end(Buffer.from(buffer));
  }
}
