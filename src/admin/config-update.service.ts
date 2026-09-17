import { Injectable, Logger } from "@nestjs/common";
import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { stringify as stringifyToml } from "smol-toml";
import type { LauncherConfigDto } from "../launcher/dto/dto";

const CONFIG_FILE = "config.toml";

@Injectable()
export class ConfigUpdateService {
  private readonly logger = new Logger(ConfigUpdateService.name);

  update(dto: LauncherConfigDto): LauncherConfigDto {
    const content = stringifyToml(dto as unknown as Record<string, unknown>);
    this.writeAtomically(`${content}\n`);

    this.logger.log({ projectName: dto.projectName }, "Конфиг лаунчера обновлён");

    return dto;
  }

  private writeAtomically(content: string): void {
    const tmpPath = `${CONFIG_FILE}.tmp`;
    try {
      writeFileSync(tmpPath, content);
      renameSync(tmpPath, CONFIG_FILE);
    } finally {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    }
  }
}
