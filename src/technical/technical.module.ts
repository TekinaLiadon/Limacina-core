import { Module } from "@nestjs/common";
import { TechnicalBootstrapService } from "./technical-bootstrap.service";
import { TechnicalRestartService } from "./technical-restart.service";
import { TechnicalRebuildService } from "./technical-rebuild.service";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AdminModule, AuthModule, AppConfigModule],
  providers: [TechnicalBootstrapService, TechnicalRestartService, TechnicalRebuildService],
  exports: [TechnicalBootstrapService, TechnicalRestartService, TechnicalRebuildService],
})
export class TechnicalModule {}
