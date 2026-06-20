import { Module } from "@nestjs/common";
import { FilesModule } from "./files/files.module";
import { AuthModule } from "./auth/auth.module";
import { YggdrasilModule } from "./yggdrasil/yggdrasil.module";
import { LoggerModule } from "nestjs-pino";
import GlobalConfig from "./config/global-config";
import LogConfig from "./config/log-config";
import { createLogStream } from "./config/log-stream";

@Module({
  imports: [
    GlobalConfig.asModule,
    LoggerModule.forRoot({
      pinoHttp: {
        name: "Limacina",
        level: LogConfig.parseEnvOrExit().LOG_LEVEL,
        ...(process.env.NODE_ENV !== "production"
          ? { transport: { target: "pino-pretty" } }
          : { stream: createLogStream() }),
        customProps: (req) => ({
          url: req.url,
          method: req.method,
        }),
      },
    }),
    FilesModule,
    AuthModule,
    YggdrasilModule,
  ],
})
export class AppModule {}
