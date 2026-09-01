import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { FilesModule } from "./files/files.module";
import { AuthModule } from "./auth/auth.module";
import { YggdrasilModule } from "./yggdrasil/yggdrasil.module";
import { AdminModule } from "./admin/admin.module";
import { LauncherModule } from "./launcher/launcher.module";
import { TechnicalModule } from "./technical/technical.module";
import { UserContentModule } from "./user-content/user-content.module";
import { V1Module } from "./v1/v1.module";
import { CommonModule } from "./common/common.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { Jwt_authGuard } from "./common/jwt_auth.guard";
import { RolesGuard } from "./common/roles.guard";
import { LoggerModule } from "nestjs-pino";
import GlobalConfig from "./config/global-config";
import { buildPinoHttpOptions } from "./config/pino-options";

@Module({
  imports: [
    GlobalConfig.asModule,
    LoggerModule.forRoot({
      pinoHttp: buildPinoHttpOptions(),
    }),
    CommonModule,
    FilesModule,
    AuthModule,
    YggdrasilModule,
    AdminModule,
    LauncherModule,
    TechnicalModule,
    UserContentModule,
    V1Module,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: Jwt_authGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
