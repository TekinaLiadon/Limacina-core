import { Body, Controller, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/public.decorator";
import { CurrentUser, type RequestUser } from "../../../common/current-user.decorator";
import { SuccessResponseDto } from "../../../common/dto/dto";
import { AuthService } from "../../../auth/service/auth.service";
import {
  AuthDto,
  AuthResponseDto,
  AuthRefreshDto,
  ChangePasswordDto,
  RegisterDto,
} from "../../../auth/dto/dto";

@ApiTags("common_auth")
@Controller("v1/common/auth")
export class V1AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("registration")
  @Public()
  @ApiOperation({ summary: "Регистрация нового пользователя" })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: "Пользователь зарегистрирован, возвращает токены и данные пользователя",
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 409, description: "Юзернейм уже занят" })
  @ApiResponse({
    status: 400,
    description:
      "Ошибка валидации: username — 3–16 символов (латиница, цифры, _), password — 6–128 символов",
  })
  async postRegistration(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto.username, dto.password);
  }

  @Post("login")
  @Public()
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
  @ApiResponse({
    status: 400,
    description: "Ошибка валидации: username — до 64 символов, password — 6–128 символов",
  })
  async postLogin(@Body() dto: AuthDto): Promise<AuthResponseDto> {
    return this.authService.login(dto.username, dto.password);
  }

  @Post("refresh")
  @Public()
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
  @ApiResponse({ status: 400, description: "Ошибка валидации: refresh_token обязателен" })
  async postRefresh(@Body() dto: AuthRefreshDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post("invalidate")
  @Public()
  @ApiOperation({
    summary: "Инвалидация refresh токена",
    description:
      "Идемпотентен: проверяется только подпись refresh-токена. " +
      "Если jti уже удалён (повторный logout, ротация через refresh), ответ всё равно 201.",
  })
  @ApiBody({ type: AuthRefreshDto })
  @ApiResponse({
    status: 201,
    description: "Refresh токен инвалидирован",
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 401, description: "Невалидный refresh токен" })
  @ApiResponse({ status: 400, description: "Ошибка валидации: refresh_token обязателен" })
  async postInvalidate(@Body() dto: AuthRefreshDto): Promise<SuccessResponseDto> {
    await this.authService.invalidate(dto.refresh_token);
    return { success: true };
  }

  @Patch("password")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Смена собственного пароля",
    description:
      "Меняет пароль текущего пользователя по старому паролю. " +
      "Все refresh токены пользователя инвалидируются, в ответе выдаётся свежая пара токенов.",
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: "Пароль изменён, возвращает новую пару токенов",
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: "Неверный текущий пароль или нет токена" })
  @ApiResponse({ status: 400, description: "Новый пароль короче 6 символов" })
  async patchPassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResponseDto> {
    return this.authService.changePassword(user.username, dto.old_password, dto.new_password);
  }
}
