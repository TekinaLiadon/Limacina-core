import type { Options } from "pino-http";
import LogConfig from "./log-config";
import { createLogStream } from "./log-stream";

export function buildPinoHttpOptions(): Options {
  return {
    name: "Limacina",
    level: LogConfig.parseEnvOrExit().LOG_LEVEL,
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : "info"),
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "refresh_token",
      "access_token",
      "accessToken",
      "clientToken",
      "refreshToken",
      "*.password",
      "*.refresh_token",
      "*.access_token",
      "*.accessToken",
      "*.clientToken",
      "*.refreshToken",
    ],
    ...(process.env.NODE_ENV !== "production"
      ? { transport: { target: "pino-pretty" } }
      : { stream: createLogStream() }),
  };
}
