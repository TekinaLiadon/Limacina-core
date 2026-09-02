import { Body, Controller, Post } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/public.decorator";
import { SuccessResponseDto } from "../../../common/dto/dto";
import { AuthService } from "../../../auth/service/auth.service";
import { AuthDto, AuthResponseDto, AuthRefreshDto } from "../../../auth/dto/dto";

@ApiTags("common_auth")
@Public()
@Controller("v1/common/auth")
export class V1AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("registration")
  @ApiOperation({ summary: "Регистрация нового пользователя" })
  @ApiBody({ type: AuthDto })
  @ApiResponse({
    status: 201,
    description: "Пользователь зарегистрирован, возвращает токены и данные пользователя",
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 409, description: "Юзернейм уже занят" })
  async postRegistration(@Body() dto: AuthDto): Promise<AuthResponseDto> {
    return this.authService.register(dto.username, dto.password);
  }

  @Post("login")
  @ApiOperation({ summary: "Авторизация пользователя" })
  @ApiBody({ type: AuthDto })
  @ApiResponse({
    status: 201,
    description: "Успешный логин, возвращает токены и данные пользователя",
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: "Неверное имя пользователя или пароль",
  })
  async postLogin(@Body() dto: AuthDto): Promise<AuthResponseDto> {
    return this.authService.login(dto.username, dto.password);
  }

  @Post("refresh")
  @ApiOperation({ summary: "Обновление пары токенов" })
  @ApiBody({ type: AuthRefreshDto })
  @ApiResponse({
    status: 201,
    description: "Токены обновлены, возвращает новую пару",
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: "Невалидный или инвалидированный refresh токен",
  })
  async postRefresh(@Body() dto: AuthRefreshDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post("invalidate")
  @ApiOperation({ summary: "Инвалидация refresh токена" })
  @ApiBody({ type: AuthRefreshDto })
  @ApiResponse({
    status: 201,
    description: "Refresh токен инвалидирован",
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 401, description: "Невалидный refresh токен" })
  async postInvalidate(@Body() dto: AuthRefreshDto): Promise<SuccessResponseDto> {
    await this.authService.invalidate(dto.refresh_token);
    return { success: true };
  }
}
