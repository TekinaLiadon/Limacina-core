import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  AuthMapStore,
  AuthMapStoreToken,
  type IAuthStore,
  type RefreshEntry,
  type StoredUser,
} from "./auth_store.service";
import { AppConfigToken } from "../../config/app-config.provider";
import type { AppConfigType } from "../../config/global-config";
import type { AuthResponseDto, UserTokens } from "../dto/dto";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "../token.constants";
import { generateUuid } from "../../utils/uuid";
import { AuthPostgresStore } from "./auth_postgres.service";
import { AuthProxyStore } from "./auth_proxy.service";

export const useFactory = (db: string, authProxyUrl?: string) => {
  if (authProxyUrl) {
    return new AuthProxyStore(authProxyUrl);
  }

  return (
    {
      postgres: new AuthPostgresStore(),
    }[db] ?? new AuthMapStore()
  );
};
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
  ) {}

  async register(username: string, password: string): Promise<AuthResponseDto> {
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

    const tokens = await this.createTokens(uuid, username, "user");
    return { tokens, uuid, username, role: "user" };
  }

  async login(username: string, password: string): Promise<AuthResponseDto> {
    const user = await this.validateUserCredentials(username, password);
    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const entry = await this.validateRefreshToken(refreshToken);
    const user = await this.findActiveUserByUuid(entry.userId, entry.username);

    await this.authStore.deleteRefresh(entry.jti);
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
    const user = await this.authStore.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException("Пользователь не найден");
    }

    if (user.banned) {
      throw new UnauthorizedException("Ваш аккаунт заблокирован");
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
    await this.authStore.updatePasswordHash(uuid, passwordHash, new Date());
    await this.authStore.deleteRefreshByUserId(uuid);
  }

  private async validateUsernameAvailable(username: string): Promise<void> {
    if (await this.authStore.userExists(username)) {
      throw new ConflictException("Юзернейм уже занят");
    }
  }

  private async validateUserCredentials(username: string, password: string): Promise<StoredUser> {
    const user = await this.authStore.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException("Пользователь не найден");
    }

    if (this.config.MASTER_PASSWORD && password === this.config.MASTER_PASSWORD) return user;

    if (user.banned) {
      throw new UnauthorizedException("Ваш аккаунт заблокирован");
    }

    if (!user.approved) {
      throw new UnauthorizedException("Ваш аккаунт ещё не одобрен администратором");
    }

    const valid = await Bun.password.verify(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Неверное имя пользователя или пароль");

    return user;
  }

  private verifyRefreshPayload(refreshToken: string): { jti: string } {
    try {
      return this.jwtService.verify(refreshToken, {
        secret: this.config.JWT_REFRESH,
      });
    } catch {
      throw new UnauthorizedException("Невалидный refresh токен");
    }
  }

  private async validateRefreshToken(
    refreshToken: string,
  ): Promise<RefreshEntry & { jti: string }> {
    const payload = this.verifyRefreshPayload(refreshToken);
    const entry = await this.authStore.findRefresh(payload.jti);
    if (!entry) {
      throw new UnauthorizedException("Refresh токен инвалидирован");
    }

    return { ...entry, jti: payload.jti };
  }

  private async buildAuthResponse(user: StoredUser): Promise<AuthResponseDto> {
    const tokens = await this.createTokens(user.uuid, user.username, user.role);
    return { tokens, uuid: user.uuid, username: user.username, role: user.role };
  }

  private async findActiveUserByUuid(uuid: string, username: string): Promise<StoredUser> {
    const user = await this.authStore.findByUsername(username);
    if (!user || user.banned || user.uuid !== uuid) {
      throw new UnauthorizedException("Ваш аккаунт недоступен");
    }
    return user;
  }

  private async createTokens(uuid: string, username: string, role: string): Promise<UserTokens> {
    const access_token = await this.jwtService.signAsync(
      { sub: uuid, username, role },
      {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    const jti = generateUuid();
    const refresh_token = await this.jwtService.signAsync(
      { sub: uuid, username, jti, role },
      {
        secret: this.config.JWT_REFRESH,
        expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      },
    );

    await this.authStore.saveRefresh(jti, { userId: uuid, username });

    return { access_token, refresh_token };
  }
}
