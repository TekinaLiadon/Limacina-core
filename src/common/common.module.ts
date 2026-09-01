import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./jwt.strategy";
import { AuthStoreModule } from "../auth/service/auth_store.module";
import { AppConfigModule, AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";

@Module({
  imports: [
    PassportModule,
    AppConfigModule,
    AuthStoreModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigToken],
      useFactory: (config: AppConfigType) => ({
        secret: config.JWT_ACCESS,
        signOptions: { expiresIn: 31536000 },
      }),
    }),
  ],
  providers: [JwtStrategy],
  exports: [JwtModule],
})
export class CommonModule {}
