import {existsSync, mkdirSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {Injectable, Logger, OnModuleDestroy, NotFoundException} from "@nestjs/common";
import type {FastifyReply} from "fastify";
import chokidar, {type FSWatcher} from "chokidar";
import {FileDto} from "./dto/dto";

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

        this.logger.log({launcher: this.launcherHash.size}, "Файлы проиндексированы");
    }

    onModuleDestroy(): void {
        this.watcherLauncher?.close();
    }

    private ensureDir(dir: string): void {
        if (!existsSync(dir)) {
            mkdirSync(dir, {recursive: true});
            this.logger.log({dir}, "Папка создана");
        }
    }

    private async indexDir(dir: string, map: Map<string, string>): Promise<void> {
        if (!existsSync(dir)) return;

        const entries = readdirSync(dir, {recursive: true});
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
        const watcher = chokidar.watch(dir, {
            ignoreInitial: true,
            awaitWriteFinish: {stabilityThreshold: 200},
        });

        watcher.on("add", async (filePath: string) => {
            const namePath = filePath.replace(`${dir}/`, "");
            if (namePath.endsWith(".filepart")) return;
            if (!statSync(filePath).isFile()) return;

            const hash = await this.getHash(filePath);
            map.set(namePath, hash);
            this.logger.debug({file: namePath}, "Файл добавлен");
        });

        watcher.on("change", async (filePath: string) => {
            const namePath = filePath.replace(`${dir}/`, "");
            if (namePath.endsWith(".filepart")) return;

            const hash = await this.getHash(filePath);
            map.set(namePath, hash);
            this.logger.debug({file: namePath}, "Файл изменён");
        });

        watcher.on("unlink", (filePath: string) => {
            const namePath = filePath.replace(`${dir}/`, "");
            map.delete(namePath);
            this.logger.debug({file: namePath}, "Файл удалён");
        });

        watcher.on("error", (error: unknown) => {
            this.logger.error({err: error}, "Ошибка watcher");
        });

        return watcher;
    }

    async getHash(url: string): Promise<string> {
        const hasher = new Bun.CryptoHasher("md5");
        const file = Bun.file(url);

        if (!(await file.exists())) {
            this.logger.warn({url}, "Файл не найден при хэшировании");
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
        const prefix = `${folder}/`;
        const entries = [...this.launcherHash.entries()].filter(([key]) => key.startsWith(prefix));
        return Object.fromEntries(entries);
    }

    async postFile(fileInfo: FileDto, reply: FastifyReply): Promise<void> {
        const filePath = join("public", "launcher", fileInfo.url);
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
}
