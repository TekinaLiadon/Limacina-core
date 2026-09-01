import { Module } from "@nestjs/common";
import GlobalConfig, { type AppConfigType } from "./global-config";

export const AppConfigToken = Symbol("AppConfig");

export const AppConfigProvider = {
  provide: AppConfigToken,
  useFactory: (): AppConfigType => GlobalConfig.parseEnvOrExit(),
};

@Module({
  providers: [AppConfigProvider],
  exports: [AppConfigToken],
})
export class AppConfigModule {}
