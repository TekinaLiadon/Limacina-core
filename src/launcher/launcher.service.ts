import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from "@nestjs/common";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import chokidar, { type FSWatcher } from "chokidar";
import type { LauncherConfigDto } from "./dto/dto";
import type { FastifyReply } from "fastify";

const PUBLIC_DIR = "public";
const VERSION_FILE = join(PUBLIC_DIR, "version.json");
const CONFIG_FILE = "config.toml";

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
  private platformsWatcher?: FSWatcher;

  async onApplicationBootstrap() {
    this.loadVersion();
    this.watchVersion();
    this.scanPlatforms();
    this.watchPlatforms();

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
    this.versionWatcher = chokidar.watch(VERSION_FILE, { ignoreInitial: true });

    this.versionWatcher.on("change", () => {
      this.loadVersion();
      this.scanPlatforms();
      this.logger.log(
        { version: this.version, platforms: this.platforms.length },
        "Версия лаунчера обновлена",
      );
    });

    this.versionWatcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher version.json");
    });
  }

  private watchPlatforms(): void {
    const dirs = Object.entries(SUPPORTED_PLATFORMS).flatMap(([os, archs]) =>
      archs.map((arch) => join(PUBLIC_DIR, os, arch)),
    );

    this.platformsWatcher = chokidar.watch(dirs, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    this.platformsWatcher.on("add", (filePath: string) => {
      if (!filePath.endsWith(".zip")) return;

      this.scanPlatforms();
      this.logger.log({ file: filePath }, "Платформенный файл добавлен");
    });

    this.platformsWatcher.on("unlink", (filePath: string) => {
      if (!filePath.endsWith(".zip")) return;

      this.scanPlatforms();
      this.logger.log({ file: filePath }, "Платформенный файл удалён");
    });

    this.platformsWatcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher платформ");
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

  getConfig(): LauncherConfigDto {
    if (!existsSync(CONFIG_FILE)) {
      throw new NotFoundException("Конфиг не настроен: файл config.toml не найден");
    }

    const content = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = parseToml(content) as unknown as LauncherConfigDto;

    return parsed;
  }

  createConfig(dto: LauncherConfigDto): LauncherConfigDto {
    if (existsSync(CONFIG_FILE)) return this.getConfig();

    const content = stringifyToml(dto as unknown as Record<string, unknown>);
    writeFileSync(CONFIG_FILE, content + "\n");

    this.logger.log({ projectName: dto.projectName }, "Конфиг лаунчера создан");

    return dto;
  }

  onModuleDestroy(): void {
    this.versionWatcher?.close();
    this.platformsWatcher?.close();
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
