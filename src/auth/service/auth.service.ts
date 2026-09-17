import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { timingSafeEqual } from "node:crypto";
import { AuthStoreToken, type IAuthStore, type StoredUser } from "./auth_store";
import { AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import type { AuthResponseDto, UserTokensDto } from "../dto/dto";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "../token.constants";
import { validatePasswordPolicy } from "../password-policy";
import { generateUuid } from "../../utils/uuid";

const INVALID_CREDENTIALS_MESSAGE = "Неверное имя пользователя или пароль";

@Injectable()
export class AuthService {
  private dummyPasswordHash: Promise<string> | undefined;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(AuthStoreToken) private readonly authStore: IAuthStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
  ) {}

  async register(username: string, password: string): Promise<AuthResponseDto> {
    validatePasswordPolicy(password);

    await this.validateUsernameAvailable(username);

    const uuid = generateUuid();
    const passwordHash = await Bun.password.hash(password);

    const saved = await this.authStore.saveUser({
      uuid,
      username,
      passwordHash,
      role: "user",
      approved: false,
      banned: false,
    });
    if (!saved) {
      throw new ConflictException("Юзернейм уже занят");
    }

    try {
      const tokens = await this.createTokens(uuid, username, "user");
      return { tokens, uuid, username, role: "user" };
    } catch (error) {
      await this.rollbackRegistration(uuid);
      throw error;
    }
  }

  async login(username: string, password: string): Promise<AuthResponseDto> {
    const user = await this.validateUserCredentials(username, password);
    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const payload = this.verifyRefreshPayload(refreshToken);
    const entry = await this.authStore.findRefresh(payload.jti);
    if (!entry) {
      throw new UnauthorizedException("Refresh токен инвалидирован");
    }

    const user = await this.findActiveUserByUuid(entry.userId, entry.username);

    const claimed = await this.authStore.claimRefresh(payload.jti);
    if (!claimed) {
      throw new UnauthorizedException("Refresh токен инвалидирован");
    }
    return this.buildAuthResponse(user);
  }

  async invalidate(refreshToken: string): Promise<void> {
    const payload = this.verifyRefreshPayload(refreshToken);
    await this.authStore.deleteRefresh(payload.jti);
  }

  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<AuthResponseDto> {
    validatePasswordPolicy(newPassword);

    const user = await this.authStore.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException("Пользователь не найден");
    }

    if (user.banned || !user.approved) {
      throw new UnauthorizedException("Нет доступа");
    }

    const validOldPassword = await Bun.password.verify(oldPassword, user.passwordHash);
    if (!validOldPassword) {
      throw new UnauthorizedException("Неверный текущий пароль");
    }

    await this.replacePassword(user.uuid, newPassword);
    return this.buildAuthResponse(user);
  }

  private async replacePassword(uuid: string, newPassword: string): Promise<void> {
    const passwordHash = await Bun.password.hash(newPassword);
    await this.authStore.replacePassword(uuid, passwordHash, new Date());
  }

  private async rollbackRegistration(uuid: string): Promise<void> {
    try {
      await this.authStore.deleteUser(uuid);
    } catch (error) {
      this.logger.error(
        { err: error, uuid },
        "Не удалось откатить регистрацию после сбоя выпуска токенов",
      );
    }
  }

  private isMasterPassword(password: string): boolean {
    const master = this.config.MASTER_PASSWORD;
    if (!master) return false;

    const masterHash = new Bun.CryptoHasher("sha256").update(master).digest();
    const passwordHash = new Bun.CryptoHasher("sha256").update(password).digest();
    return timingSafeEqual(masterHash, passwordHash);
  }

  private async validateUsernameAvailable(username: string): Promise<void> {
    if (await this.authStore.userExists(username)) {
      throw new ConflictException("Юзернейм уже занят");
    }
  }

  private async validateUserCredentials(username: string, password: string): Promise<StoredUser> {
    const user = await this.authStore.findByUsername(username);
    if (!user) {
      await this.matchPasswordVerifyTiming(password);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (this.isMasterPassword(password)) return user;

    const valid = await Bun.password.verify(password, user.passwordHash);
    if (!valid || user.banned || !user.approved) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return user;
  }

  private async matchPasswordVerifyTiming(password: string): Promise<void> {
    this.dummyPasswordHash ??= Bun.password.hash(generateUuid());
    await Bun.password.verify(password, await this.dummyPasswordHash);
  }

  private verifyRefreshPayload(refreshToken: string): { jti: string } {
    try {
      const payload = this.jwtService.verify<{ jti?: string; typ?: string }>(refreshToken, {
        secret: this.config.JWT_REFRESH,
      });
      if (payload.typ !== "refresh" || !payload.jti) {
        throw new Error("Unexpected token type");
      }
      return { jti: payload.jti };
    } catch {
      throw new UnauthorizedException("Невалидный refresh токен");
    }
  }

  private async buildAuthResponse(user: StoredUser): Promise<AuthResponseDto> {
    const tokens = await this.createTokens(user.uuid, user.username, user.role);
    return { tokens, uuid: user.uuid, username: user.username, role: user.role };
  }

  private async findActiveUserByUuid(uuid: string, username: string): Promise<StoredUser> {
    const user = await this.authStore.findByUsername(username);
    if (!user || user.uuid !== uuid) {
      throw new UnauthorizedException("Ваш аккаунт недоступен");
    }
    if (user.banned || !user.approved) {
      throw new UnauthorizedException("Нет доступа");
    }
    return user;
  }

  private async createTokens(uuid: string, username: string, role: string): Promise<UserTokensDto> {
    const access_token = await this.jwtService.signAsync(
      { sub: uuid, username, role, typ: "access", jti: generateUuid() },
      {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    const jti = generateUuid();
    const refresh_token = await this.jwtService.signAsync(
      { sub: uuid, username, jti, role, typ: "refresh" },
      {
        secret: this.config.JWT_REFRESH,
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      },
    );

    await this.authStore.saveRefresh(
      jti,
      { userId: uuid, username },
      new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    );

    return { access_token, refresh_token };
  }
}
