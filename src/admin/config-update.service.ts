import { Injectable, Logger } from "@nestjs/common";
import { writeFileSync } from "node:fs";
import { stringify as stringifyToml } from "smol-toml";
import type { LauncherConfigUpdateDto } from "./dto/dto";

const CONFIG_FILE = "config.toml";

@Injectable()
export class ConfigUpdateService {
  private readonly logger = new Logger(ConfigUpdateService.name);

  update(dto: LauncherConfigUpdateDto): LauncherConfigUpdateDto {
    const content = stringifyToml(dto as unknown as Record<string, unknown>);
    writeFileSync(CONFIG_FILE, content + "\n");

    this.logger.log({ projectName: dto.projectName }, "Конфиг лаунчера обновлён");

    return dto;
  }
}
