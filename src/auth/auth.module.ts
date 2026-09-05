import { Module } from "@nestjs/common";
import { AuthService } from "./service/auth.service";
import { AuthStoreModule } from "./service/auth_store.module";
import { CommonModule } from "../common/common.module";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AppConfigModule, CommonModule, AuthStoreModule],
  providers: [AuthService],
  exports: [AuthService, AuthStoreModule],
})
export class AuthModule {}
