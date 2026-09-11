import { z } from "zod";
import { ZodEnvConfig } from "./zod-env";

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().default(3005),
    JWT_ACCESS: z.string().min(32),
    JWT_REFRESH: z.string().min(32),
    DB_DRIVER: z.enum(["map", "postgres"]).default("map"),
    AUTH_PROXY_URL: z.string().url().optional(),
    BASE_URL: z.string().url(),
    MASTER_PASSWORD: z.string().min(1).optional(),
    MAX_SKINS_PER_USER: z.coerce.number().int().min(0).default(1),
    MAX_MODELS_PER_USER: z.coerce.number().int().min(0).default(1),
    MAX_CAPES_PER_USER: z.coerce.number().int().min(0).default(1),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH_WINDOW: z.coerce.number().int().min(1000).default(60000),
    TRUST_PROXY: z.string().optional(),
    KEYS_DIR: z.string().optional(),
    DATABASE_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().url().optional(),
    CACHE_PREFIX: z.string().optional(),
    MINECRAFT_HOST: z.string().optional(),
    DEPLOY_PINNED_REVISION: z
      .string()
      .regex(/^[0-9a-f]{40}$/, "DEPLOY_PINNED_REVISION must be a full 40-char git SHA")
      .optional(),
  })
  .refine((config) => config.NODE_ENV !== "production" || config.DB_DRIVER !== "map", {
    message: "DB_DRIVER=map is not allowed in production — use DB_DRIVER=postgres",
    path: ["DB_DRIVER"],
  })
  .refine((config) => config.DB_DRIVER !== "postgres" || config.DATABASE_URL !== undefined, {
    message: "DATABASE_URL is required when DB_DRIVER=postgres",
    path: ["DATABASE_URL"],
  });

const AppConfig = new ZodEnvConfig("app", configSchema);

export type AppConfigType = z.output<typeof configSchema>;

export default AppConfig;
