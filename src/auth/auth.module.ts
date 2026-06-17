import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import {AuthService, useFactory} from "./service/auth.service";
import { AuthMapStoreToken } from "./service/auth_store.service";
import { JwtStrategy } from "./jwt.strategy";
import GlobalConfig from "../config/global-config";

const config = GlobalConfig.parseEnvOrExit();

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: config.JWT_ACCESS,
      signOptions: { expiresIn: 31536000 },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    {
      provide: AuthMapStoreToken,
      useFactory: () => useFactory(config.DB_DRIVER),
    }
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
