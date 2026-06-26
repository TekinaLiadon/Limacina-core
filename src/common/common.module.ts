import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
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
  providers: [JwtStrategy],
  exports: [JwtModule],
})
export class CommonModule {}
