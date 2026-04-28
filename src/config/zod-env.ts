import z from "zod";

import { Logger } from "@nestjs/common";
import { ConfigModule, ConfigService, registerAs } from "@nestjs/config";

import type { DynamicModule } from "@nestjs/common";

export class ZodEnvConfig<T extends z.ZodType<Record<string, unknown>>> {
  readonly factory;

  constructor(
    readonly name: string,
    readonly schema: T,
  ) {
    this.factory = registerAs(this.name, () => this.parseEnvOrExit());
  }

  get providerKey() {
    return this.factory.KEY;
  }

  get asModule(): DynamicModule {
    return ConfigModule.forFeature(this.factory);
  }

  from(config: ConfigService): z.output<T> {
    return config.getOrThrow<z.output<T>>(this.name);
  }

  tryParseEnv(env = process.env) {
    return this.schema.safeParse({
      ...env,
      ...JSON.parse(env["SECRETS"] ?? "{}"),
    });
  }

  parseEnvOrExit(env = process.env): z.output<T> {
    const result = this.tryParseEnv(env);
    if (result.success) {
      return result.data;
    }

    const logger = new Logger("Config");
    logger.error({ ...z.flattenError(result.error).fieldErrors }, "Invalid environment variables");
    Logger.flush();
    process.exit(1);
  }
}
