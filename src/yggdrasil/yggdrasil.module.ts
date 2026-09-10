import { Module } from "@nestjs/common";
import { YggdrasilController } from "./yggdrasil.controller";
import { YggdrasilService } from "./service/yggdrasil.service";
import { YggdrasilSessionStoreToken, YggdrasilTokenStoreToken } from "./service/yggdrasil_store";
import { YggdrasilMapSessionStore, YggdrasilMapTokenStore } from "../memory/yggdrasil-map.store";
import { MemoryModule } from "../memory/memory.module";
import { MemoryDb } from "../memory/memory-db";
import { YggdrasilProfileStoreModule } from "./service/yggdrasil_store.module";
import { UserContentModule } from "../user-content/user-content.module";
import { AppConfigModule } from "../config/app-config.provider";

@Module({
  imports: [AppConfigModule, UserContentModule, MemoryModule, YggdrasilProfileStoreModule],
  controllers: [YggdrasilController],
  providers: [
    YggdrasilService,
    {
      provide: YggdrasilTokenStoreToken,
      useFactory: (db: MemoryDb) => new YggdrasilMapTokenStore(db),
      inject: [MemoryDb],
    },
    {
      provide: YggdrasilSessionStoreToken,
      useFactory: (db: MemoryDb) => new YggdrasilMapSessionStore(db),
      inject: [MemoryDb],
    },
  ],
  exports: [YggdrasilService],
})
export class YggdrasilModule {}
