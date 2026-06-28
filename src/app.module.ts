import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { FilesModule } from "./files/files.module";
import { AuthModule } from "./auth/auth.module";
import { YggdrasilModule } from "./yggdrasil/yggdrasil.module";
import { AdminModule } from "./admin/admin.module";
import { LauncherModule } from "./launcher/launcher.module";
import { CommonModule } from "./common/common.module";
import { Jwt_authGuard } from "./common/jwt_auth.guard";
import { RolesGuard } from "./common/roles.guard";
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
    CommonModule,
    FilesModule,
    AuthModule,
    YggdrasilModule,
    AdminModule,
    LauncherModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: Jwt_authGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
