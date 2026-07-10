import { Module } from "@nestjs/common";
import { TechnicalController } from "./technical.controller";
import { TechnicalService } from "./technical.service";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AdminModule, AuthModule],
  controllers: [TechnicalController],
  providers: [TechnicalService],
})
export class TechnicalModule {}
