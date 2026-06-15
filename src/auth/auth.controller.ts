import { Body, Controller, Post } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { AuthDto, ProfileInfo, RefreshDto } from "./dto/dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("registration")
  @ApiOperation({ summary: "Регистрация нового пользователя" })
  @ApiBody({ type: AuthDto })
  @ApiResponse({
    status: 201,
    description: "Пользователь зарегистрирован, возвращает токены и профиль",
    type: ProfileInfo,
  })
  @ApiResponse({ status: 401, description: "Юзернейм уже занят" })
  async postRegistration(@Body() dto: AuthDto): Promise<ProfileInfo> {
    return this.authService.register(dto.username, dto.password);
  }

  @Post("login")
  @ApiOperation({ summary: "Авторизация пользователя" })
  @ApiBody({ type: AuthDto })
  @ApiResponse({
    status: 201,
    description: "Успешный логин, возвращает токены и профиль",
    type: ProfileInfo,
  })
  @ApiResponse({
    status: 401,
    description: "Неверное имя пользователя или пароль",
  })
  async postLogin(@Body() dto: AuthDto): Promise<ProfileInfo> {
    return this.authService.login(dto.username, dto.password);
  }

  @Post("refresh")
  @ApiOperation({ summary: "Обновление пары токенов" })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({
    status: 201,
    description: "Токены обновлены, возвращает новую пару и профиль",
    type: ProfileInfo,
  })
  @ApiResponse({
    status: 401,
    description: "Невалидный или инвалидированный refresh токен",
  })
  async postRefresh(@Body() dto: RefreshDto): Promise<ProfileInfo> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post("invalidate")
  @ApiOperation({ summary: "Инвалидация refresh токена" })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({
    status: 201,
    description: "Refresh токен инвалидирован",
    schema: { type: "object", properties: { success: { type: "boolean", example: true } } },
  })
  @ApiResponse({ status: 401, description: "Невалидный refresh токен" })
  async postInvalidate(@Body() dto: RefreshDto): Promise<{ success: boolean }> {
    await this.authService.invalidate(dto.refresh_token);
    return { success: true };
  }
}
