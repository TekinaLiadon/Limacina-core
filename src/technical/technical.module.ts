import { Module } from "@nestjs/common";
import { TechnicalService } from "./technical.service";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AdminModule, AuthModule, AppConfigModule],
  providers: [TechnicalService],
  exports: [TechnicalService],
})
export class TechnicalModule {}
