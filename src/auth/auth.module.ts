import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService, useFactory } from "./service/auth.service";
import { AuthMapStoreToken } from "./service/auth_store.service";
import { CommonModule } from "../common/common.module";
import GlobalConfig from "../config/global-config";

const config = GlobalConfig.parseEnvOrExit();

@Module({
  imports: [CommonModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: AuthMapStoreToken,
      useFactory: () => useFactory(config.DB_DRIVER),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
