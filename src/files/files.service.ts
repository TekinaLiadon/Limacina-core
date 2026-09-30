import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { watch, type FSWatcher } from "chokidar";
import { FileDto } from "./dto/dto";
import { streamFileToReply } from "../utils/file-stream";

const LAUNCHER_DIR = "public/launcher";

export const MODS_FOLDER = "mods";

export const FILES_LIST_EXCLUDED_FOLDERS: string[] = [MODS_FOLDER];

export const FILES_RESCAN_INTERVAL_MS = 30_000;

export interface FilesPage {
  files: Record<string, string>;
  total: number;
}

const isExcludedFolder = (key: string): boolean =>
  FILES_LIST_EXCLUDED_FOLDERS.some((folder) => key.startsWith(`${folder}/`));

function encodeAttachmentFilename(filename: string): string {
  return encodeURIComponent(filename)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

@Injectable()
export class FilesService implements OnModuleDestroy {
  readonly logger: Logger = new Logger(FilesService.name);
  watcherLauncher!: FSWatcher;

  private readonly filesRescanIntervalMs: number;
  private rescanTimer: Timer | undefined;

  readonly launcherHash: Map<string, string> = new Map();

  constructor(@Optional() filesRescanIntervalMs: number = FILES_RESCAN_INTERVAL_MS) {
    this.filesRescanIntervalMs = filesRescanIntervalMs;
  }

  async onApplicationBootstrap() {
    this.ensureDir(LAUNCHER_DIR);

    await this.indexDir(LAUNCHER_DIR, this.launcherHash);

    this.watcherLauncher = this.createWatcher(LAUNCHER_DIR, this.launcherHash);
    this.startIndexRescan();

    this.logger.log({ launcher: this.launcherHash.size }, "Файлы проиндексированы");
  }

  onModuleDestroy(): void {
    this.watcherLauncher?.close();
    clearInterval(this.rescanTimer);
    this.rescanTimer = undefined;
  }

  private startIndexRescan(): void {
    this.rescanTimer = setInterval(() => {
      try {
        this.reconcileLauncherIndex();
      } catch (error) {
        this.logger.error({ err: error }, "Ошибка сверки манифеста файлов с диском");
      }
    }, this.filesRescanIntervalMs);
    this.rescanTimer.unref();
  }

  private reconcileLauncherIndex(): void {
    for (const namePath of [...this.launcherHash.keys()]) {
      if (existsSync(join(LAUNCHER_DIR, namePath))) continue;
      this.launcherHash.delete(namePath);
      this.logger.debug({ file: namePath }, "Файл отсутствует на диске, запись манифеста удалена");
    }
    this.indexMissingFiles(LAUNCHER_DIR, this.launcherHash);
  }

  private indexMissingFiles(dir: string, map: Map<string, string>): void {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir, { recursive: true })) {
      const namePath = String(entry);
      if (map.has(namePath)) continue;
      void this.indexFile(dir, map, join(dir, namePath));
    }
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.log({ dir }, "Папка создана");
    }
  }

  private async indexDir(dir: string, map: Map<string, string>): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { recursive: true });
    await Promise.all(
      entries.map(async (entry) => {
        await this.indexFile(dir, map, join(dir, String(entry)));
      }),
    );
  }

  private async indexFile(dir: string, map: Map<string, string>, fullPath: string): Promise<void> {
    const namePath = fullPath.replace(`${dir}/`, "");
    if (namePath.endsWith(".filepart")) return;

    try {
      if (!statSync(fullPath).isFile()) return;

      const hash = await this.getHash(fullPath);
      if (!hash) return;
      if (!existsSync(fullPath)) return;
      map.set(namePath, hash);
    } catch (error) {
      this.logger.error({ err: error, file: namePath }, "Не удалось проиндексировать файл");
    }
  }

  private createWatcher(dir: string, map: Map<string, string>): FSWatcher {
    const watcher = watch(dir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    watcher.on("add", (filePath: string) => {
      void this.handleWatcherFileEvent(dir, map, filePath, "добавлен");
    });

    watcher.on("change", (filePath: string) => {
      void this.handleWatcherFileEvent(dir, map, filePath, "изменён");
    });

    watcher.on("unlink", (filePath: string) => {
      try {
        const namePath = filePath.replace(`${dir}/`, "");
        map.delete(namePath);
        this.logger.debug({ file: namePath }, "Файл удалён");
      } catch (error) {
        this.logger.error({ err: error, file: filePath }, "Ошибка обработки удаления файла");
      }
    });

    watcher.on("error", (error: unknown) => {
      this.logger.error({ err: error }, "Ошибка watcher");
    });

    return watcher;
  }

  private async handleWatcherFileEvent(
    dir: string,
    map: Map<string, string>,
    filePath: string,
    event: string,
  ): Promise<void> {
    try {
      const namePath = filePath.replace(`${dir}/`, "");
      if (namePath.endsWith(".filepart")) return;

      const hash = await this.getHash(filePath);
      if (!hash) return;
      if (!existsSync(filePath)) return;
      map.set(namePath, hash);
      this.logger.debug({ file: namePath, event }, "Файл лаунчера обновлён");
    } catch (error) {
      this.logger.error({ err: error, file: filePath, event }, "Ошибка обработки события watcher");
    }
  }

  async getHash(url: string): Promise<string | null> {
    const hasher = new Bun.CryptoHasher("sha1");
    const file = Bun.file(url);

    if (!(await file.exists())) {
      this.logger.warn({ url }, "Файл не найден при хэшировании");
      return null;
    }

    const readable = file.stream();
    for await (const chunk of readable) {
      hasher.update(chunk);
    }
    return hasher.digest("hex");
  }

  getList(offset?: number, limit?: number): FilesPage {
    return this.pageFiles(
      [...this.launcherHash.entries()].filter(([key]) => !isExcludedFolder(key)),
      offset,
      limit,
    );
  }

  getExtraList(folder: string, offset?: number, limit?: number): FilesPage {
    return this.pageFiles(
      [...this.launcherHash.entries()].filter(([key]) => key.startsWith(`${folder}/`)),
      offset,
      limit,
    );
  }

  private pageFiles(
    entries: [string, string][],
    offset: number | undefined,
    limit: number | undefined,
  ): FilesPage {
    const sorted = entries.toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const start = offset ?? 0;
    const page = limit === undefined ? sorted.slice(start) : sorted.slice(start, start + limit);
    return { files: Object.fromEntries(page), total: sorted.length };
  }

  async sendFile(fileInfo: FileDto, reply: FastifyReply): Promise<void> {
    const filePath = this.resolveLauncherPath(fileInfo.url);

    await streamFileToReply(reply, filePath, {
      contentType: "application/octet-stream",
      contentDisposition: `attachment; filename*=UTF-8''${encodeAttachmentFilename(fileInfo.url)}`,
      notFoundMessage: `Файл не найден: ${fileInfo.url}`,
      fileLabel: fileInfo.url,
    });
  }

  private resolveLauncherPath(requestedUrl: string): string {
    const launcherRoot = resolve(LAUNCHER_DIR);
    const filePath = resolve(launcherRoot, requestedUrl);
    const relativePath = relative(launcherRoot, filePath);

    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      this.logger.warn({ requestedUrl }, "Попытка доступа вне папки лаунчера");
      throw new BadRequestException("Недопустимый путь к файлу");
    }

    return filePath;
  }
}
