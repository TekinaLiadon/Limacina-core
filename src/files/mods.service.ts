import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { CacheStoreToken, type ICacheStore } from "../cache/cache_store";
import { UPLOAD_TMP_DIR } from "../launcher/launcher-files";
import { isMissingFileError, removeFilesQuietly } from "../utils/fs";
import { withPathLock } from "../utils/path-lock";
import { LAUNCHER_DIR, MODS_FOLDER } from "./files.service";
import { normalizeModEntryName, type StagedModUpload } from "./mods-upload.parser";
import type { ModFileDto, ModsUploadResponseDto } from "./dto/dto";

export const MODS_CACHE_KEY = "launcher-mods";
export const MODS_LIST_CACHE_TTL_MS = 30_000;

const MODS_DIR = join(LAUNCHER_DIR, MODS_FOLDER);
const MODS_LOCK_KEY = "launcher-mods";
const HIDDEN_NAME_PREFIX = ".";

@Injectable()
export class ModsService {
  private readonly logger = new Logger(ModsService.name);

  constructor(
    @Inject(CacheStoreToken) private readonly cache: ICacheStore,
    @Optional() private readonly modsDir: string = MODS_DIR,
    @Optional() private readonly uploadTmpDir: string = UPLOAD_TMP_DIR,
  ) {}

  async getMods(): Promise<ModFileDto[]> {
    const cached = await this.cache.get<ModFileDto[]>(MODS_CACHE_KEY);
    if (cached) return cached;

    const mods = this.readModsFromDisk();
    await this.cache.set(MODS_CACHE_KEY, mods, MODS_LIST_CACHE_TTL_MS);
    return mods;
  }

  async uploadMods(uploads: StagedModUpload[]): Promise<ModsUploadResponseDto> {
    if (uploads.length === 0) {
      throw new BadRequestException("Нужен хотя бы один файл мода");
    }

    try {
      await withPathLock(MODS_LOCK_KEY, async (): Promise<void> => {
        mkdirSync(this.modsDir, { recursive: true });
        const backups = new Map<string, string>();
        const committed: string[] = [];
        try {
          for (const upload of uploads) {
            const target = this.resolveModPath(upload.name);
            this.backupExistingMod(target, backups);
            renameSync(upload.tempPath, target);
            committed.push(target);
          }
        } catch (error) {
          this.rollbackMods(committed, backups);
          throw error;
        } finally {
          removeFilesQuietly(this.logger, [...backups.values()], "Не удалось удалить бэкап мода");
        }
      });
    } finally {
      removeFilesQuietly(
        this.logger,
        uploads.map((upload) => upload.tempPath),
        "Не удалось удалить временный файл загрузки мода",
      );
    }

    await this.invalidateCache();
    const names = uploads.map((upload) => upload.name);
    this.logger.log({ mods: names }, "Моды загружены");
    return { uploaded: names };
  }

  async deleteMod(rawName: string): Promise<void> {
    const name = normalizeModEntryName(rawName);

    await withPathLock(MODS_LOCK_KEY, async (): Promise<void> => {
      const target = this.resolveModPath(name);
      if (!this.isModFile(target)) {
        throw new NotFoundException(`Мод не найден: ${name}`);
      }
      unlinkSync(target);
    });

    await this.invalidateCache();
    this.logger.log({ mod: name }, "Мод удалён");
  }

  private readModsFromDisk(): ModFileDto[] {
    if (!existsSync(this.modsDir)) return [];

    const mods: ModFileDto[] = [];
    for (const entry of readdirSync(this.modsDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(HIDDEN_NAME_PREFIX)) continue;

      const size = this.readModSize(entry.name);
      if (size === undefined) continue;
      mods.push({ name: entry.name, size });
    }

    return mods.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  }

  private readModSize(name: string): number | undefined {
    try {
      return statSync(join(this.modsDir, name)).size;
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      this.logger.error({ err: error, mod: name }, "Не удалось прочитать размер мода");
      return undefined;
    }
  }

  private isModFile(target: string): boolean {
    try {
      return statSync(target).isFile();
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  private resolveModPath(name: string): string {
    const modsRoot = resolve(this.modsDir);
    const target = resolve(modsRoot, name);
    const relativePath = relative(modsRoot, target);

    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new BadRequestException(`Недопустимое имя файла мода: ${name}`);
    }
    return target;
  }

  private backupExistingMod(target: string, backups: Map<string, string>): void {
    if (!existsSync(target)) return;
    if (!statSync(target).isFile()) {
      throw new BadRequestException(
        `Мод с именем ${basename(target)} уже существует и не является файлом`,
      );
    }

    mkdirSync(this.uploadTmpDir, { recursive: true });
    const backup = join(this.uploadTmpDir, `${randomUUID()}.backup`);
    renameSync(target, backup);
    backups.set(target, backup);
  }

  private rollbackMods(committed: string[], backups: Map<string, string>): void {
    for (const target of committed.toReversed()) {
      try {
        if (existsSync(target)) unlinkSync(target);
      } catch (error) {
        this.logger.error({ err: error, mod: target }, "Не удалось откатить загруженный мод");
      }
    }
    for (const [target, backup] of backups) {
      try {
        renameSync(backup, target);
      } catch (error) {
        this.logger.error({ err: error, mod: target }, "Не удалось восстановить заменённый мод");
      }
    }
  }

  private async invalidateCache(): Promise<void> {
    await this.cache.delete(MODS_CACHE_KEY);
  }
}
