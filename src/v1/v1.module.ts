import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { LauncherModule } from "../launcher/launcher.module";
import { TechnicalModule } from "../technical/technical.module";
import { UserContentModule } from "../user-content/user-content.module";
import { YggdrasilModule } from "../yggdrasil/yggdrasil.module";
import { V1AuthController } from "./common/auth/auth.controller";
import { V1ContentController } from "./common/content/content.controller";
import { V1LauncherConfigController } from "./launcher/config.controller";
import { V1LauncherFilesController } from "./launcher/files.controller";
import { V1LauncherUpdateController } from "./launcher/update.controller";
import { V1PanelLauncherController } from "./panel/launcher.controller";
import { V1PanelLogsController } from "./panel/logs.controller";
import { V1PanelUsersController } from "./panel/users.controller";
import { V1YggdrasilController } from "./yggdrasil/yggdrasil.controller";

@Module({
  imports: [
    AdminModule,
    AuthModule,
    FilesModule,
    LauncherModule,
    TechnicalModule,
    UserContentModule,
    YggdrasilModule,
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
    V1YggdrasilController,
  ],
})
export class V1Module {}
