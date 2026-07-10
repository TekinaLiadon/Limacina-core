import { Body, Controller, Post } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../common/public.decorator";
import { TechnicalService } from "./technical.service";
import { InitOwnerDto } from "./dto/dto";

@ApiTags("technical")
@Public()
@Controller("technical")
export class TechnicalController {
  constructor(private readonly technicalService: TechnicalService) {}

  @Post("init-owner")
  @ApiOperation({
    summary: "Создать владельца",
    description:
      "Регистрирует пользователя с правами owner. Доступно только если owner ещё не создан.",
  })
  @ApiBody({ type: InitOwnerDto })
  @ApiResponse({
    status: 201,
    description: "Владелец создан",
    schema: {
      type: "object",
      properties: {
        uuid: { type: "string", example: "a1b2c3d4e5f6" },
        username: { type: "string", example: "owner" },
      },
    },
  })
  @ApiResponse({ status: 409, description: "Владелец уже создан или юзернейм занят" })
  async initOwner(@Body() dto: InitOwnerDto) {
    return this.technicalService.initOwner(dto.username, dto.password);
  }
}
