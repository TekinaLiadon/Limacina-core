import { Module } from "@nestjs/common";
import { FilesModule } from "./files/files.module";
import { LoggerModule } from "nestjs-pino";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        name: "Limacina",
        level: process.env.NODE_ENV !== "production" ? "debug" : "info",
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
