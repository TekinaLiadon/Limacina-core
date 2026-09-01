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
    const secrets = parseSecrets(env["SECRETS"]);
    if (!secrets.ok) {
      return {
        success: false as const,
        error: new z.ZodError([
          {
            code: "custom",
            path: ["SECRETS"],
            message: "SECRETS must be valid JSON",
            input: env["SECRETS"],
          },
        ]),
      };
    }

    return this.schema.safeParse({
      ...env,
      ...secrets.value,
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

function parseSecrets(
  raw: string | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (raw === undefined) return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}
