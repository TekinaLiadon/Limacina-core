import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./service/auth.service";
import { AuthStoreModule } from "./service/auth_store.module";
import { CommonModule } from "../common/common.module";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AppConfigModule, CommonModule, AuthStoreModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, AuthStoreModule],
})
export class AuthModule {}
