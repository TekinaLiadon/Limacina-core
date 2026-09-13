import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { AppConfigToken } from "./app-config.provider";
import type { AppConfigType } from "./global-config";
import { closeSqlPool } from "../utils/sql";

@Injectable()
export class SqlPoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(AppConfigToken) private readonly config: AppConfigType) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.config.NODE_ENV === "test") return;
    await closeSqlPool();
  }
}
