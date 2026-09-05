import { Module } from "@nestjs/common";
import { TechnicalService } from "./technical.service";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AdminModule, AuthModule],
  providers: [TechnicalService],
  exports: [TechnicalService],
})
export class TechnicalModule {}
