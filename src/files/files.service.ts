import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  NotFoundException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { watch, type FSWatcher } from "chokidar";
import { FileDto } from "./dto/dto";

const LAUNCHER_DIR = "public/launcher";

@Injectable()
export class FilesService implements OnModuleDestroy {
  readonly logger: Logger = new Logger(FilesService.name);
  watcherLauncher!: FSWatcher;

  readonly launcherHash: Map<string, string> = new Map();

  async onApplicationBootstrap() {
    this.ensureDir(LAUNCHER_DIR);

    await this.indexDir(LAUNCHER_DIR, this.launcherHash);

    this.watcherLauncher = this.createWatcher(LAUNCHER_DIR, this.launcherHash);

    this.logger.log({ launcher: this.launcherHash.size }, "Файлы проиндексированы");
  }

  onModuleDestroy(): void {
    this.watcherLauncher?.close();
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
      const namePath = filePath.replace(`${dir}/`, "");
      map.delete(namePath);
      this.logger.debug({ file: namePath }, "Файл удалён");
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
    const namePath = filePath.replace(`${dir}/`, "");
    if (namePath.endsWith(".filepart")) return;

    try {
      const hash = await this.getHash(filePath);
      if (!hash) return;
      map.set(namePath, hash);
      this.logger.debug({ file: namePath, event }, "Файл лаунчера обновлён");
    } catch (error) {
      this.logger.error({ err: error, file: namePath, event }, "Ошибка обработки события watcher");
    }
  }

  async getHash(url: string): Promise<string | null> {
    const hasher = new Bun.CryptoHasher("md5");
    const file = Bun.file(url);

    if (!(await file.exists())) {
      this.logger.warn({ url }, "Файл не найден при хэшировании");
      return null;
    }

    const buffer = await file.arrayBuffer();
    hasher.update(buffer);
    return hasher.digest("hex");
  }

  getList(): Record<string, string> {
    return Object.fromEntries(this.launcherHash);
  }

  getExtraList(folder: string): Record<string, string> {
    const prefix = `${folder}/`;
    const entries = [...this.launcherHash.entries()].filter(([key]) => key.startsWith(prefix));
    return Object.fromEntries(entries);
  }

  async sendFile(fileInfo: FileDto, reply: FastifyReply): Promise<void> {
    const filePath = this.resolveLauncherPath(fileInfo.url);
    if (!existsSync(filePath)) {
      throw new NotFoundException(`Файл не найден: ${fileInfo.url}`);
    }

    const file = Bun.file(filePath);
    const encodedFilename = encodeURIComponent(fileInfo.url)
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\*/g, "%2A");

    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodedFilename}`);
    reply.header("Content-Length", (await file.size).toString());
    reply.send(file.stream());
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
