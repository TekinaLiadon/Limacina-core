import z from "zod";
import { ZodEnvConfig } from "./zod-env";

const configSchema = z
  .object({
    NODE_ENV: z.string(),
    PORT: z.coerce.number().default(3005),
    JWT_ACCESS: z.string().min(1),
    JWT_REFRESH: z.string().min(1),
    DB_DRIVER: z.enum(["map", "postgres"]).default("map"),
    YGGDRASIL_PROXY_URL: z.string().url().optional(),
    BASE_URL: z.string().url().default("http://localhost:3005"),
    MASTER_PASSWORD: z.string().min(1).optional(),
    MAX_SKINS_PER_USER: z.coerce.number().int().min(0).default(1),
    MAX_MODELS_PER_USER: z.coerce.number().int().min(0).default(1),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH_WINDOW: z.coerce.number().int().min(1000).default(60000),
    TRUST_PROXY: z.string().optional(),
  })
  .refine((config) => config.NODE_ENV !== "production" || config.DB_DRIVER !== "map", {
    message: "DB_DRIVER=map is not allowed in production — use DB_DRIVER=postgres",
    path: ["DB_DRIVER"],
  });

const AppConfig = new ZodEnvConfig("app", configSchema);

export type AppConfigType = z.output<typeof configSchema>;

export default AppConfig;
