import { z } from "zod";
import { ZodEnvConfig } from "./zod-env";

const logSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  LOG_LEVEL: z.enum(["info", "debug"]).default("info"),
});
const LogConfig = new ZodEnvConfig("pino-logger", logSchema);
export default LogConfig;
