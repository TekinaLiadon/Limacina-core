import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/public.decorator";
import { LauncherService } from "../../launcher/launcher.service";
import { LauncherConfigDto } from "../../launcher/dto/dto";

@ApiTags("launcher_config")
@Public()
@Controller("v1/launcher/config")
export class V1LauncherConfigController {
  constructor(private readonly launcherService: LauncherService) {}

  @Get()
  @ApiOperation({ summary: "Получить конфиг лаунчера" })
  @ApiOkResponse({ type: LauncherConfigDto })
  getConfig(): LauncherConfigDto {
    return this.launcherService.getConfig();
  }
}
