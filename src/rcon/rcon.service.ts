import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { CacheStoreToken, type ICacheStore } from "../cache/cache_store";
import { validationMessages } from "../common/validation-messages";
import { DEFAULT_RCON_COMMANDS } from "./rcon-commands";
import { SourceRconClient, type RconResult, type RconTarget } from "./source-rcon-client";
import type { RconCommandsDto, RconOutputDto, RconStatusDto } from "./dto/dto";

export const RCON_STATUS_CACHE_KEY = "rcon-status";
const RCON_STATUS_CACHE_TTL_MS = 10_000;
const RCON_COMMAND_MAX_LENGTH = 256;
const NOT_CONFIGURED_MESSAGE = "RCON не настроен на сервере";
const PARTIAL_CONFIG_MESSAGE =
  "RCON настроен частично — задайте и RCON_HOST, и RCON_PASSWORD, иначе RCON-эндпоинты отключены";

export interface RconClient {
  checkAvailable(): Promise<boolean>;
  executeCommand(command: string): Promise<RconResult>;
}

export const RconClientToken = Symbol("RconClient");

class DisabledRconClient implements RconClient {
  async checkAvailable(): Promise<boolean> {
    return false;
  }

  async executeCommand(): Promise<RconResult> {
    return { ok: false, error: NOT_CONFIGURED_MESSAGE };
  }
}

export function createRconClient(config: AppConfigType): RconClient {
  if (!config.RCON_HOST || !config.RCON_PASSWORD) return new DisabledRconClient();

  const target: RconTarget = {
    host: config.RCON_HOST,
    port: config.RCON_PORT,
    password: config.RCON_PASSWORD,
  };
  return new SourceRconClient(target);
}

function normalizeCommand(raw: string): string {
  const command = raw.trim().replaceAll(/^\/+/g, "");
  if (command.length === 0) {
    throw new BadRequestException(validationMessages.notEmpty("command"));
  }
  if (command.length > RCON_COMMAND_MAX_LENGTH) {
    throw new BadRequestException(validationMessages.maxLength("command", RCON_COMMAND_MAX_LENGTH));
  }
  return command;
}

@Injectable()
export class RconService {
  private readonly logger = new Logger(RconService.name);
  private readonly configured: boolean;

  constructor(
    @Inject(AppConfigToken) config: AppConfigType,
    @Inject(CacheStoreToken) private readonly cache: ICacheStore,
    @Inject(RconClientToken) private readonly client: RconClient,
  ) {
    this.configured = !!(config.RCON_HOST && config.RCON_PASSWORD);
    if (!this.configured && (config.RCON_HOST || config.RCON_PASSWORD)) {
      this.logger.warn(PARTIAL_CONFIG_MESSAGE);
    }
  }

  async getStatus(): Promise<RconStatusDto> {
    if (!this.configured) return { enabled: false };

    const cached = await this.cache.get<RconStatusDto>(RCON_STATUS_CACHE_KEY);
    if (cached) return cached;

    const status: RconStatusDto = { enabled: await this.client.checkAvailable() };
    await this.cache.set(RCON_STATUS_CACHE_KEY, status, RCON_STATUS_CACHE_TTL_MS);
    return status;
  }

  getCommands(): RconCommandsDto {
    return { commands: [...DEFAULT_RCON_COMMANDS] };
  }

  async execute(rawCommand: string): Promise<RconOutputDto> {
    if (!this.configured) {
      throw new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE);
    }

    const command = normalizeCommand(rawCommand);
    const result = await this.client.executeCommand(command);
    if (!result.ok) {
      this.logger.error({ command, error: result.error }, "Команда RCON не выполнена");
      throw new ServiceUnavailableException(result.error);
    }

    return { output: result.output };
  }
}
