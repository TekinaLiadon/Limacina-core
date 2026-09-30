import { z } from "zod";
import { ZodEnvConfig } from "./zod-env";

const CORS_ORIGINS_MAX = 100;

export const DEFAULT_RCON_PORT = 25575;

const corsOriginsSchema = z
  .string()
  .transform((raw) => {
    const origins = raw
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (origins.length === 0) return undefined;
    return origins.slice(0, CORS_ORIGINS_MAX);
  })
  .optional();

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().default(3005),
    JWT_ACCESS: z.string().min(32),
    JWT_REFRESH: z.string().min(32),
    DB_DRIVER: z.enum(["map", "postgres", "mariadb"]).default("map"),
    AUTH_PROXY_URL: z.string().url().optional(),
    BASE_URL: z.string().url().default("http://localhost:3005"),
    MASTER_PASSWORD: z.string().min(1).optional(),
    CORS_ORIGINS: corsOriginsSchema,
    MAX_SKINS_PER_USER: z.coerce.number().int().min(0).default(1),
    MAX_MODELS_PER_USER: z.coerce.number().int().min(0).default(1),
    MAX_CAPES_PER_USER: z.coerce.number().int().min(0).default(1),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH_WINDOW: z.coerce.number().int().min(1000).default(60000),
    RATE_LIMIT_AUTH_IP_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(600),
    RATE_LIMIT_GLOBAL_WINDOW: z.coerce.number().int().min(1000).default(60000),
    BEHIND_PROXY: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    TRUST_PROXY: z.string().optional(),
    KEYS_DIR: z.string().optional(),
    DATABASE_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().url().optional(),
    CACHE_PREFIX: z.string().optional(),
    MINECRAFT_HOST: z.string().optional(),
    RCON_HOST: z.string().optional(),
    RCON_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_RCON_PORT),
    RCON_PASSWORD: z.string().optional(),
    DEPLOY_PINNED_REVISION: z
      .string()
      .regex(/^[0-9a-f]{40}$/, "DEPLOY_PINNED_REVISION must be a full 40-char git SHA")
      .optional(),
  })
  .refine((config) => config.NODE_ENV !== "production" || config.DB_DRIVER !== "map", {
    message: "DB_DRIVER=map is not allowed in production — use DB_DRIVER=postgres or mariadb",
    path: ["DB_DRIVER"],
  })
  .refine((config) => !isSqlDriver(config.DB_DRIVER) || config.DATABASE_URL !== undefined, {
    message: "DATABASE_URL is required when DB_DRIVER=postgres or mariadb",
    path: ["DATABASE_URL"],
  })
  .refine((config) => !config.TRUST_PROXY || config.BEHIND_PROXY, {
    message:
      "TRUST_PROXY has no effect when BEHIND_PROXY=false — enable BEHIND_PROXY or drop TRUST_PROXY",
    path: ["TRUST_PROXY"],
  });

const SQL_DRIVERS = ["postgres", "mariadb"] as const;

export type SqlDriver = (typeof SQL_DRIVERS)[number];

export function isSqlDriver(driver: string): driver is SqlDriver {
  return (SQL_DRIVERS as readonly string[]).includes(driver);
}

export function createStoreByDriver<T>(
  dbDriver: string,
  stores: { sql: () => T; map: () => T },
): T {
  return isSqlDriver(dbDriver) ? stores.sql() : stores.map();
}

const AppConfig = new ZodEnvConfig("app", configSchema);

export type AppConfigType = z.output<typeof configSchema>;

export default AppConfig;
