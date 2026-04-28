import { Module } from "@nestjs/common";
import { FilesModule } from "./files/files.module";
import { LoggerModule } from "nestjs-pino";
import globalConfig from "./config/global-config";
import logConfig from "./config/log-config";

@Module({
  imports: [
    globalConfig.asModule,
    LoggerModule.forRoot({
      pinoHttp: {
        name: "Limacina",
        level: logConfig.LOG_LEVEL,
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
