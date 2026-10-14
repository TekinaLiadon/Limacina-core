import { existsSync, readFileSync } from "node:fs";
import { Injectable, Logger, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { parse as parseToml } from "smol-toml";
import { watch, type FSWatcher } from "chokidar";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CONFIG_FILE } from "./launcher-files";
import { LauncherConfigDto } from "./dto/dto";

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

  private config: LauncherConfigDto | undefined;
  private configWatcher?: FSWatcher;

  async onApplicationBootstrap() {
    this.loadConfig();
    this.watchConfig();
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

  getConfig(): LauncherConfigDto {
    if (!this.config) {
      throw new NotFoundException("Конфиг не настроен: файл config.toml не найден");
    }

    return this.config;
  }

  onModuleDestroy(): void {
    this.configWatcher?.close();
  }
}
