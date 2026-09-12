import { existsSync, readdirSync, readFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from "@nestjs/common";
import { parse as parseToml } from "smol-toml";
import { watch, type FSWatcher } from "chokidar";
import type { LauncherConfigDto, LauncherVersionsDto } from "./dto/dto";
import type { FastifyReply } from "fastify";
import {
  LAUNCHER_VERSION_REGEX,
  OLD_VERSIONS_DIR,
  SUPPORTED_PLATFORMS,
  buildLauncherZipName,
  compareVersions,
  isSupportedPlatform,
  parseLauncherZipName,
} from "./launcher-files";

const PUBLIC_DIR = "public";
const VERSION_FILE = join(PUBLIC_DIR, "version.json");
const CONFIG_FILE = "config.toml";

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

interface PlatformInfo {
  os: string;
  arch: string;
}

function extractVersion(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { version } = data as { version?: unknown };
  if (typeof version !== "string" || !LAUNCHER_VERSION_REGEX.test(version)) return undefined;
  return version;
}

@Injectable()
export class LauncherService implements OnModuleDestroy {
  private readonly logger = new Logger(LauncherService.name);

  private version = "0.0.0";
  private platforms: PlatformInfo[] = [];
  private config: LauncherConfigDto | undefined;
  private versionWatcher?: FSWatcher;
  private platformsWatcher?: FSWatcher;
  private configWatcher?: FSWatcher;

  async onApplicationBootstrap() {
    this.loadVersion();
    this.watchVersion();
    this.scanPlatforms();
    this.watchPlatforms();
    this.loadConfig();
    this.watchConfig();

    this.logger.log(
      { version: this.version, platforms: this.platforms.length },
      "Лаунчер проиндексирован",
    );
  }

  private loadVersion(): void {
    try {
      const data: unknown = JSON.parse(readFileSync(VERSION_FILE, "utf-8"));
      const version = extractVersion(data);
      if (version) {
        this.version = version;
        return;
      }
      this.logger.warn(
        { file: VERSION_FILE },
        "Некорректная форма version.json, используется 0.0.0",
      );
      this.version = "0.0.0";
    } catch (error) {
      this.logger.warn(
        { err: error, file: VERSION_FILE },
        "Ошибка чтения version.json, используется 0.0.0",
      );
      this.version = "0.0.0";
    }
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

    try {
      const content = readFileSync(CONFIG_FILE, "utf-8");
      this.config = parseToml(content) as unknown as LauncherConfigDto;
    } catch (error) {
      this.logger.error({ err: error }, "Ошибка чтения config.toml");
      this.config = undefined;
    }
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
    try {
      if (!filePath.endsWith(".zip")) return;
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
    this.platformsWatcher?.close();
    this.configWatcher?.close();
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

    const filePath = join(dir, zipFile);

    let handle: FileHandle;
    try {
      handle = await open(filePath, "r");
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new NotFoundException(`Файл лаунчера не найден: ${zipFile}`);
      }
      throw error;
    }

    let closed = false;
    const closeHandle = (): void => {
      if (closed) return;
      closed = true;
      void handle
        .close()
        .catch((closeError: unknown) =>
          this.logger.error({ err: closeError, file: zipFile }, "Не удалось закрыть файл лаунчера"),
        );
    };

    try {
      const { size } = await handle.stat();
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="${zipFile}"`);
      reply.header("Content-Length", size.toString());
      reply.raw.once("close", closeHandle);
      const fileStream = Readable.fromWeb(
        Bun.file(handle.fd).stream() as unknown as NodeWebReadableStream,
      );
      fileStream.on("error", (error: Error) => {
        this.logger.error({ err: error, file: zipFile }, "Ошибка отдачи файла лаунчера");
      });
      reply.send(fileStream);
    } catch (error) {
      closeHandle();
      throw error;
    }
  }

  private findCurrentZip(dir: string, os: string, arch: string): string | null {
    const expectedZip = buildLauncherZipName(this.version, os, arch);
    return readdirSync(dir).includes(expectedZip) ? expectedZip : null;
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
