import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { parseMinecraftTarget, status, type MinecraftTarget } from "./minecraft-slp";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import type { MinecraftStatusDto } from "./dto/dto";
import { CacheStoreToken, type ICacheStore } from "../cache/cache.store";

export const STATUS_CACHE_KEY = "minecraft-status";
const STATUS_CACHE_TTL_MS = 60_000;
export const FAILURE_COOLDOWN_MS = 5_000;
const TARGET_PARSE_ERROR =
  "Некорректный MINECRAFT_HOST — ожидается host, host:port или [ipv6]:port";
const SERVER_UNAVAILABLE_MESSAGE = "Игровой сервер недоступен";

@Injectable()
export class MinecraftStatusService {
  private readonly logger = new Logger(MinecraftStatusService.name);
  private readonly target: MinecraftTarget | undefined;
  private pendingPing: Promise<MinecraftStatusDto> | undefined;
  private failureCooldownUntil = 0;
  readonly failureCooldownMs: number = FAILURE_COOLDOWN_MS;

  constructor(
    @Inject(AppConfigToken) config: AppConfigType,
    @Inject(CacheStoreToken) private readonly cache: ICacheStore,
  ) {
    if (config.MINECRAFT_HOST) {
      this.target = parseMinecraftTarget(config.MINECRAFT_HOST) ?? undefined;
    }
  }

  async getOnline(): Promise<MinecraftStatusDto> {
    if (!this.target) {
      this.logger.error(TARGET_PARSE_ERROR);
      throw new ServiceUnavailableException(TARGET_PARSE_ERROR);
    }

    const cached = await this.cache.get<MinecraftStatusDto>(STATUS_CACHE_KEY);
    if (cached) return cached;

    if (this.pendingPing) return this.pendingPing;

    if (Date.now() < this.failureCooldownUntil) {
      throw new ServiceUnavailableException(SERVER_UNAVAILABLE_MESSAGE);
    }

    this.pendingPing = this.pingAndCache(this.target);
    try {
      return await this.pendingPing;
    } finally {
      this.pendingPing = undefined;
    }
  }

  private async pingAndCache(target: MinecraftTarget): Promise<MinecraftStatusDto> {
    const result = await status(target.host, target.port);
    if (!result.ok) {
      this.failureCooldownUntil = Date.now() + this.failureCooldownMs;
      this.logger.error(
        { host: target.host, port: target.port, error: result.error },
        "Игровой сервер недоступен",
      );
      throw new ServiceUnavailableException(SERVER_UNAVAILABLE_MESSAGE);
    }

    const response: MinecraftStatusDto = {
      online: result.status.online,
      max: result.status.max,
      version: result.status.version,
    };
    await this.cache.set(STATUS_CACHE_KEY, response, STATUS_CACHE_TTL_MS);
    return response;
  }
}
