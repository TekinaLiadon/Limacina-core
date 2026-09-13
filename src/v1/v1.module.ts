import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { LauncherModule } from "../launcher/launcher.module";
import { MinecraftStatusModule } from "../minecraft-status/minecraft-status.module";
import { TechnicalModule } from "../technical/technical.module";
import { UserContentModule } from "../user-content/user-content.module";
import { V1AuthController } from "./common/auth/auth.controller";
import { V1ContentController } from "./common/content/content.controller";
import { V1LauncherConfigController } from "./launcher/config.controller";
import { V1LauncherFilesController } from "./launcher/files.controller";
import { V1LauncherUpdateController } from "./launcher/update.controller";
import { V1PanelLauncherController } from "./panel/launcher.controller";
import { V1PanelLogsController } from "./panel/logs.controller";
import { V1PanelServerController } from "./panel/server.controller";
import { V1PanelUsersController } from "./panel/users.controller";
import { V1StatusController } from "./common/status/status.controller";

@Module({
  imports: [
    AdminModule,
    AuthModule,
    FilesModule,
    LauncherModule,
    MinecraftStatusModule,
    TechnicalModule,
    UserContentModule,
  ],
  controllers: [
    V1AuthController,
    V1ContentController,
    V1LauncherUpdateController,
    V1LauncherConfigController,
    V1LauncherFilesController,
    V1PanelUsersController,
    V1PanelLogsController,
    V1PanelLauncherController,
    V1PanelServerController,
    V1StatusController,
  ],
})
export class V1Module {}
