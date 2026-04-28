import { Module } from "@nestjs/common";
import { FilesModule } from "./files/files.module";
import { LoggerModule } from "nestjs-pino";
import GlobalConfig from "./config/global-config";
import LogConfig from "./config/log-config";

@Module({
  imports: [
    GlobalConfig.asModule,
    LoggerModule.forRoot({
      pinoHttp: {
        name: "Limacina",
        level: LogConfig.parseEnvOrExit().LOG_LEVEL,
        transport: {
          target: "pino-pretty",
        },
        customProps: (req) => ({
          url: req.url,
          method: req.method,
        }),
      },
    }),
    FilesModule,
  ],
})
export class AppModule {}
