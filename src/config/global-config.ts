import z from "zod";
import { ZodEnvConfig } from "./zod-env";

const configSchema = z.object({
  NODE_ENV: z.string(),
  PORT: z.coerce.number().default(3005),
  JWT_ACCESS: z.string().min(1),
  JWT_REFRESH: z.string().min(1),
  DB_DRIVER: z.enum(["map", "postgres", "sqlite"]).default("map"),
  YGGDRASIL_PROXY_URL: z.string().url().optional(),
  BASE_URL: z.string().url().default("http://localhost:3005"),
});

const AppConfig = new ZodEnvConfig("app", configSchema);
export default AppConfig;
