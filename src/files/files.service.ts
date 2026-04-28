import { Injectable, Logger } from "@nestjs/common";
import chokidar from "chokidar";
import { FileDto } from "./dto/dto";

@Injectable()
export class FilesService {
  readonly logger: Logger = new Logger(FilesService.name);
  readonly watcherFiles = chokidar;

  readonly filesHash: Map<string, string> = new Map();

  onApplicationBootstrap() {
    this.watcherFiles
      .watch("public", {
        interval: 10000,
        binaryInterval: 10000,
      })
      .on("all", async (event, path) => {
        const namePath = path.replace("public/", "");

        if (event === "add" || event === "change") {
          const hash: string = await this.getHash(path);
          this.filesHash.set(namePath, hash);
        }

        if (event === "unlink") {
          this.filesHash.delete(namePath);
        }
      })
      .on("ready", () => {
        this.logger.log({ filesIndexed: this.filesHash.size }, "Файлы проиндексированы");
      });
  }

  async getHash(url: string): Promise<string> {
    const hasher = new Bun.CryptoHasher("md5");
    const readStream = Bun.file(url);
    const file = await readStream.stream();

    for await (const chunk of file) {
      hasher.update(chunk);
    }
    return hasher.digest("hex");
  }

  getList(): Record<string, string> {
    return Object.fromEntries(this.filesHash);
  }

  postFile(fileInfo: FileDto): Response {
    return new Response(Bun.file(`public/${fileInfo.url}`));
  }
}
