import * as z from "zod";
import { ZodEnvConfig } from "./zodEnv";

const configSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
});

const AppConfig = new ZodEnvConfig("app", configSchema);
export default AppConfig;
