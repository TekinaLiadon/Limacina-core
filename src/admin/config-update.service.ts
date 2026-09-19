import { Injectable, Logger } from "@nestjs/common";
import { stringify as stringifyToml } from "smol-toml";
import { writeFileAtomicSync } from "../utils/fs";
import type { LauncherConfigDto } from "../launcher/dto/dto";

const CONFIG_FILE = "config.toml";

@Injectable()
export class ConfigUpdateService {
  private readonly logger = new Logger(ConfigUpdateService.name);

  update(dto: LauncherConfigDto): LauncherConfigDto {
    const content = stringifyToml(dto as unknown as Record<string, unknown>);
    writeFileAtomicSync(CONFIG_FILE, `${content}\n`);

    this.logger.log({ projectName: dto.projectName }, "Конфиг лаунчера обновлён");

    return dto;
  }
}
