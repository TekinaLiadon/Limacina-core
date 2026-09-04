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
import { watch, type FSWatcher } from "chokidar";
import type { LauncherConfigDto, LauncherVersionsDto } from "./dto/dto";
import type { FastifyReply } from "fastify";
import {
  LAUNCHER_VERSION_REGEX,
  OLD_VERSIONS_DIR,
  SUPPORTED_PLATFORMS,
  buildLauncherZipName,
  compareVersions,
  parseLauncherZipName,
} from "./launcher-files";

const PUBLIC_DIR = "public";
const VERSION_FILE = join(PUBLIC_DIR, "version.json");
const CONFIG_FILE = "config.toml";

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
    this.versionWatcher = watch(VERSION_FILE, { ignoreInitial: true });

    this.versionWatcher.on("change", () => {
      this.handleVersionChange();
    });

    this.versionWatcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher version.json");
    });
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

  private watchPlatforms(): void {
    const dirs = Object.entries(SUPPORTED_PLATFORMS).flatMap(([os, archs]) =>
      archs.map((arch) => join(PUBLIC_DIR, os, arch)),
    );

    this.platformsWatcher = watch(dirs, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    this.platformsWatcher.on("add", (filePath: string) => {
      this.handlePlatformFileChange(filePath, "добавлен");
    });

    this.platformsWatcher.on("unlink", (filePath: string) => {
      this.handlePlatformFileChange(filePath, "удалён");
    });

    this.platformsWatcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher платформ");
    });
  }

  private handlePlatformFileChange(filePath: string, event: string): void {
    if (!filePath.endsWith(".zip")) return;

    try {
      this.scanPlatforms();
      this.logger.log({ file: filePath }, `Платформенный файл ${event}`);
    } catch (error) {
      this.logger.error({ err: error, file: filePath }, "Ошибка обработки изменения платформы");
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
    writeFileSync(CONFIG_FILE, `${content}\n`);

    this.logger.log({ projectName: dto.projectName }, "Конфиг лаунчера создан");

    return dto;
  }

  onModuleDestroy(): void {
    this.versionWatcher?.close();
    this.platformsWatcher?.close();
  }

  async download(os: string, arch: string, reply: FastifyReply, version?: string): Promise<void> {
    const platform = SUPPORTED_PLATFORMS[os];
    if (!platform || !platform.includes(arch)) {
      throw new BadRequestException(`Неподдерживаемая платформа: ${os}/${arch}`);
    }

    const dir = join(PUBLIC_DIR, os, arch);
    if (!existsSync(dir)) {
      throw new NotFoundException(`Платформа не найдена: ${os}/${arch}`);
    }

    const zipFile = version ? this.findVersionZip(dir, os, arch, version) : this.findLatestZip(dir);

    if (!zipFile) {
      throw new NotFoundException(
        version
          ? `Версия ${version} не найдена для ${os}/${arch}`
          : `Файл лаунчера не найден для ${os}/${arch}`,
      );
    }

    const filePath = join(dir, zipFile);
    const file = Bun.file(filePath);

    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${zipFile}"`);
    reply.header("Content-Length", (await file.size).toString());
    reply.send(file.stream());
  }

  private findLatestZip(dir: string): string | undefined {
    return readdirSync(dir).find((file) => file.endsWith(".zip"));
  }

  private findVersionZip(dir: string, os: string, arch: string, version: string): string | null {
    if (!LAUNCHER_VERSION_REGEX.test(version)) {
      throw new BadRequestException("Версия должна быть в формате x.x.x (например 1.2.3)");
    }

    const expectedZip = buildLauncherZipName(version, os, arch);
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
