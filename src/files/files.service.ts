import { watch, type FSWatcher } from "node:fs";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { FileDto } from "./dto/dto";

const LAUNCHER_DIR = "public/launcher";
const EXTRA_DIRS = ["mods"];

@Injectable()
export class FilesService {
  readonly logger: Logger = new Logger(FilesService.name);
  watcherLauncher!: FSWatcher;
  readonly extraWatchers: FSWatcher[] = [];

  readonly launcherHash: Map<string, string> = new Map();
  readonly extraHashes: Map<string, Map<string, string>> = new Map();

  async onApplicationBootstrap() {
    this.ensureDir(LAUNCHER_DIR);

    for (const dir of EXTRA_DIRS) {
      this.ensureDir(`public/${dir}`);
      this.extraHashes.set(dir, new Map());
    }

    await this.indexDir(LAUNCHER_DIR, this.launcherHash);

    for (const dir of EXTRA_DIRS) {
      const map = this.extraHashes.get(dir)!;
      await this.indexDir(`public/${dir}`, map);
    }

    this.watcherLauncher = this.createWatcher(LAUNCHER_DIR, this.launcherHash);

    for (const dir of EXTRA_DIRS) {
      const map = this.extraHashes.get(dir)!;
      this.extraWatchers.push(this.createWatcher(`public/${dir}`, map));
    }

    this.logger.log(
      {
        launcher: this.launcherHash.size,
        extra: Object.fromEntries(EXTRA_DIRS.map((d) => [d, this.extraHashes.get(d)?.size ?? 0])),
      },
      "Файлы проиндексированы",
    );
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
        const fullPath = join(dir, String(entry));
        if (!statSync(fullPath).isFile()) return;
        if (String(entry).endsWith(".filepart")) return;

        const namePath = fullPath.replace(`${dir}/`, "");
        const hash = await this.getHash(fullPath);
        map.set(namePath, hash);
      }),
    );
  }

  private createWatcher(dir: string, map: Map<string, string>): FSWatcher {
    return watch(dir, { recursive: true }, async (event, filename) => {
      if (!filename) return;
      if (filename.endsWith(".filepart")) return;

      if (event === "change") {
        const fullPath = join(dir, filename);
        if (!existsSync(fullPath)) return;
        const hash: string = await this.getHash(fullPath);
        map.set(filename, hash);
        return;
      }

      if (event === "rename") {
        const fullPath = join(dir, filename);

        if (existsSync(fullPath)) {
          if (!statSync(fullPath).isFile()) return;
          const hash: string = await this.getHash(fullPath);
          map.set(filename, hash);
        } else {
          map.delete(filename);
        }
      }
    });
  }

  async getHash(url: string): Promise<string> {
    const hasher = new Bun.CryptoHasher("md5");
    const file = Bun.file(url);

    if (!(await file.exists())) {
      this.logger.warn({ url }, "Файл не найден при хэшировании");
      return "";
    }

    const buffer = await file.arrayBuffer();
    hasher.update(buffer);
    return hasher.digest("hex");
  }

  getList(): Record<string, string> {
    return Object.fromEntries(this.launcherHash);
  }

  getExtraList(folder: string): Record<string, string> {
    const map = this.extraHashes.get(folder);
    if (!map) {
      this.logger.warn({ folder }, "Дополнительная папка не найдена");
      return {};
    }
    return Object.fromEntries(map);
  }

  async postFile(fileInfo: FileDto, reply: FastifyReply): Promise<void> {
    const filePath = join("public", fileInfo.url);

    if (!existsSync(filePath)) {
      throw new NotFoundException(`Файл не найден: ${fileInfo.url}`);
    }

    const file = Bun.file(filePath);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${fileInfo.url}"`);
    reply.header("Content-Length", (await file.size).toString());
    reply.send(file.stream());
  }
}
