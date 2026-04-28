import z from "zod";
import { ZodEnvConfig } from "./zod-env";

const configSchema = z.object({
  NODE_ENV: z.string(),
  PORT: z.coerce.number().default(3005),
});

const AppConfig = new ZodEnvConfig("app", configSchema);
export default AppConfig;
