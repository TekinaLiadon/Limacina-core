import { z } from "zod";

import { Logger, type DynamicModule } from "@nestjs/common";
import { ConfigModule, ConfigService, registerAs } from "@nestjs/config";

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
            message: "SECRETS must be a JSON object",
          },
        ]),
      };
    }

    const mergedEnv = { ...env, ...secrets.value };
    const result = this.schema.safeParse(mergedEnv);
    if (result.success) {
      return { success: true as const, data: result.data };
    }

    const sanitizedIssues: z.core.$ZodIssue[] = result.error.issues.map(
      ({ input: _input, ...issue }) => issue,
    );
    return { success: false as const, error: new z.ZodError(sanitizedIssues) };
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
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}
