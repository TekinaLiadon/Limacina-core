import * as z from "zod";
import { ZodEnvConfig } from "./zod-env";

const logSchema = z.object({
  LOG_LEVEL: z.enum(["info", "debug"]).default("info"),
});
const logConfig = new ZodEnvConfig("pino-logger", logSchema).parseEnvOrExit();
export default logConfig;
