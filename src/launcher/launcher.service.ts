import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
} from "@nestjs/common";
import { parse as parseToml } from "smol-toml";
import { watch, type FSWatcher } from "chokidar";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { streamFileToReply } from "../utils/file-stream";
import { LauncherConfigDto, type LauncherVersionsDto } from "./dto/dto";
import type { FastifyReply } from "fastify";
import {
  CONFIG_FILE,
  OLD_VERSIONS_DIR,
  PUBLIC_DIR,
  SUPPORTED_PLATFORMS,
  buildLauncherZipName,
  compareVersions,
  isSupportedPlatform,
  parseLauncherZipName,
  validateLauncherVersion,
} from "./launcher-files";
import { VERSION_FILE, readLauncherVersion } from "./version-file";

export const PLATFORM_RESCAN_INTERVAL_MS = 30_000;

interface PlatformInfo {
  os: string;
  arch: string;
}

function platformDirs(): string[] {
  return Object.entries(SUPPORTED_PLATFORMS).flatMap(([os, archs]) =>
    archs.map((arch) => join(PUBLIC_DIR, os, arch)),
  );
}

export function parseLauncherConfig(content: string): LauncherConfigDto | undefined {
  const parsed: unknown = parseToml(content);
  const config = plainToInstance(LauncherConfigDto, parsed);
  const errors = validateSync(config, { whitelist: true });
  if (errors.length > 0) return undefined;
  return config;
}

@Injectable()
export class LauncherService implements OnModuleDestroy {
  private readonly logger = new Logger(LauncherService.name);

  private version = "0.0.0";
  private platforms: PlatformInfo[] = [];
  private config: LauncherConfigDto | undefined;
  private versionWatcher?: FSWatcher;
  private configWatcher?: FSWatcher;
  private platformsRescanTimer: Timer | undefined;

  constructor(
    @Optional()
    private readonly platformsRescanIntervalMs: number = PLATFORM_RESCAN_INTERVAL_MS,
  ) {}

  async onApplicationBootstrap() {
    this.ensureWatchedDirs();
    this.loadVersion();
    this.watchVersion();
    this.scanPlatforms();
    this.startPlatformsRescan();
    this.loadConfig();
    this.watchConfig();

    this.logger.log(
      { version: this.version, platforms: this.platforms.length },
      "Лаунчер проиндексирован",
    );
  }

  private ensureWatchedDirs(): void {
    this.ensureWatchedDir(PUBLIC_DIR);
    for (const dir of platformDirs()) {
      this.ensureWatchedDir(dir);
    }
  }

  private ensureWatchedDir(dir: string): void {
    if (existsSync(dir)) return;

    mkdirSync(dir, { recursive: true });
    this.logger.warn({ dir }, "Наблюдаемый каталог отсутствовал и создан при старте");
  }

  private loadVersion(): void {
    const version = readLauncherVersion();
    if (version) {
      this.version = version;
      return;
    }
    this.logger.warn({ file: VERSION_FILE }, "Ошибка чтения version.json, используется 0.0.0");
    this.version = "0.0.0";
  }

  private watchVersion(): void {
    this.versionWatcher = watch(PUBLIC_DIR, {
      depth: 0,
      ignoreInitial: true,
    });

    this.versionWatcher.on("all", (_event: string, filePath: string) => {
      if (filePath !== VERSION_FILE) return;
      this.handleVersionChange();
    });

    this.versionWatcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher version.json");
    });
  }

  private loadConfig(): void {
    if (!existsSync(CONFIG_FILE)) {
      this.config = undefined;
      return;
    }

    let content: string;
    try {
      content = readFileSync(CONFIG_FILE, "utf-8");
    } catch (error) {
      this.logger.error({ err: error }, "Ошибка чтения config.toml");
      this.config = undefined;
      return;
    }

    let config: LauncherConfigDto | undefined;
    try {
      config = parseLauncherConfig(content);
    } catch (error) {
      this.logger.error({ err: error }, "Ошибка чтения config.toml");
      this.config = undefined;
      return;
    }

    if (!config) {
      this.logger.warn(
        { file: CONFIG_FILE },
        "Некорректная форма config.toml, конфиг лаунчера отключён",
      );
      this.config = undefined;
      return;
    }

    this.config = config;
  }

  private watchConfig(): void {
    this.configWatcher = watch(".", {
      depth: 0,
      ignoreInitial: true,
      ignored: (path: string) => path !== "." && path !== CONFIG_FILE,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    this.configWatcher.on("add", (filePath: string) => {
      if (filePath !== CONFIG_FILE) return;
      this.handleConfigChange();
    });

    this.configWatcher.on("change", (filePath: string) => {
      if (filePath !== CONFIG_FILE) return;
      this.handleConfigChange();
    });

    this.configWatcher.on("unlink", (filePath: string) => {
      try {
        if (filePath !== CONFIG_FILE) return;
        this.config = undefined;
        this.logger.log("config.toml удалён");
      } catch (error) {
        this.logger.error({ err: error, file: filePath }, "Ошибка обработки удаления config.toml");
      }
    });

    this.configWatcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher config.toml");
    });
  }

  private handleConfigChange(): void {
    this.loadConfig();
    if (this.config) {
      this.logger.log({ projectName: this.config.projectName }, "Конфиг лаунчера перечитан");
    }
  }

  private handleVersionChange(): void {
    try {
      this.loadVersion();
      this.scanPlatforms();
      this.logger.log(
        { version: this.version, platforms: this.platforms.length },
        "Версия лаунчера обновлена",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Ошибка обработки изменения version.json");
    }
  }

  private startPlatformsRescan(): void {
    this.platformsRescanTimer = setInterval(() => {
      try {
        this.rereadVersion();
        this.rescanPlatforms();
      } catch (error) {
        this.logger.error({ err: error }, "Ошибка пересканирования платформенных каталогов");
      }
    }, this.platformsRescanIntervalMs);
    this.platformsRescanTimer.unref();
  }

  private rereadVersion(): void {
    const version = readLauncherVersion();
    if (!version || version === this.version) return;

    this.version = version;
    this.logger.log({ version }, "version.json перечитан с диска");
  }

  private rescanPlatforms(): void {
    const previous = this.platforms;
    this.scanPlatforms();

    const changed =
      previous.length !== this.platforms.length ||
      previous.some((platform, index) => {
        const current = this.platforms[index];
        return !current || current.os !== platform.os || current.arch !== platform.arch;
      });
    if (changed) {
      this.logger.log({ platforms: this.platforms }, "Набор платформ лаунчера изменился");
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
  }

  getVersions(): LauncherVersionsDto {
    const platformMap = new Map<string, PlatformInfo[]>();

    for (const [os, archs] of Object.entries(SUPPORTED_PLATFORMS)) {
      for (const arch of archs) {
        this.collectDirVersions(join(PUBLIC_DIR, os, arch), os, arch, platformMap);
        this.collectDirVersions(
          join(PUBLIC_DIR, os, arch, OLD_VERSIONS_DIR),
          os,
          arch,
          platformMap,
        );
      }
    }

    const versions = [...platformMap.entries()]
      .map(([version, platforms]) => ({ version, platforms }))
      .toSorted((a, b) => compareVersions(b.version, a.version));

    return { version: this.version, platforms: this.platforms, versions };
  }

  private collectDirVersions(
    dir: string,
    os: string,
    arch: string,
    platformMap: Map<string, PlatformInfo[]>,
  ): void {
    if (!existsSync(dir)) return;

    for (const file of readdirSync(dir)) {
      const version = parseLauncherZipName(file, os, arch);
      if (!version) continue;

      const platforms = platformMap.get(version) ?? [];
      if (!platforms.some((p) => p.os === os && p.arch === arch)) {
        platforms.push({ os, arch });
        platformMap.set(version, platforms);
      }
    }
  }

  getConfig(): LauncherConfigDto {
    if (!this.config) {
      throw new NotFoundException("Конфиг не настроен: файл config.toml не найден");
    }

    return this.config;
  }

  onModuleDestroy(): void {
    this.versionWatcher?.close();
    this.configWatcher?.close();
    clearInterval(this.platformsRescanTimer);
    this.platformsRescanTimer = undefined;
  }

  async download(os: string, arch: string, reply: FastifyReply, version?: string): Promise<void> {
    if (!isSupportedPlatform(os, arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }

    const dir = join(PUBLIC_DIR, os, arch);
    if (!existsSync(dir)) {
      throw new NotFoundException(`Платформа не найдена: ${os}/${arch}`);
    }

    const zipFile = version
      ? this.findVersionZip(dir, os, arch, version)
      : this.findCurrentZip(dir, os, arch);

    if (!zipFile) {
      throw new NotFoundException(
        version
          ? `Версия ${version} не найдена для ${os}/${arch}`
          : `Файл лаунчера версии ${this.version} не найден для ${os}/${arch}`,
      );
    }

    await streamFileToReply(reply, join(dir, zipFile), {
      contentType: "application/zip",
      contentDisposition: `attachment; filename="${basename(zipFile)}"`,
      notFoundMessage: `Файл лаунчера не найден: ${zipFile}`,
      fileLabel: zipFile,
      rangeHeader: reply.request.headers.range,
    });
  }

  private findCurrentZip(dir: string, os: string, arch: string): string | null {
    return this.findZip(dir, buildLauncherZipName(this.version, os, arch));
  }

  private findVersionZip(dir: string, os: string, arch: string, version: string): string | null {
    validateLauncherVersion(version);

    return this.findZip(dir, buildLauncherZipName(version, os, arch));
  }

  private findZip(dir: string, expectedZip: string): string | null {
    if (readdirSync(dir).includes(expectedZip)) {
      return expectedZip;
    }

    const oldDir = join(dir, OLD_VERSIONS_DIR);
    if (existsSync(oldDir) && readdirSync(oldDir).includes(expectedZip)) {
      return join(OLD_VERSIONS_DIR, expectedZip);
    }

    return null;
  }
}
