import { Injectable, Logger } from "@nestjs/common";
import { stringify as stringifyToml } from "smol-toml";
import { writeFileAtomicSync } from "../utils/fs";
import { CONFIG_FILE } from "./launcher-files";
import type { LauncherConfigDto } from "./dto/dto";

@Injectable()
export class ConfigUpdateService {
  private readonly logger = new Logger(ConfigUpdateService.name);

  update(dto: LauncherConfigDto): LauncherConfigDto {
    writeFileAtomicSync(CONFIG_FILE, `${stringifyToml(launcherConfigFields(dto))}\n`);

    this.logger.log({ projectName: dto.projectName }, "Конфиг лаунчера обновлён");

    return dto;
  }
}

function launcherConfigFields(dto: LauncherConfigDto): Record<string, unknown> {
  return {
    projectName: dto.projectName,
    mcVersion: dto.mcVersion,
    modLoader: dto.modLoader,
    loaderVersion: dto.loaderVersion,
    jvmArgs: dto.jvmArgs,
    minMemory: dto.minMemory,
    maxMemory: dto.maxMemory,
    online: dto.online,
  };
}
