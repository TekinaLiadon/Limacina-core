import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { v4 } from "uuid";
import type { IAuthStore } from "./auth_store.service";
import { AuthMapStore, AuthMapStoreToken } from "./auth_store.service";
import GlobalConfig from "../../config/global-config";
import type { AuthResponseDto, RefreshResponseDto, UserTokens } from "../dto/dto";
import type { StoredUser } from "./auth_store.service";
import type { RefreshEntry } from "./auth_store.service";
import { AuthPostgresStore } from "./auth_postgres.service";

const config = GlobalConfig.parseEnvOrExit();

export const useFactory = (db: string) => {
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
  ) {}

  async register(username: string, password: string): Promise<AuthResponseDto> {
    await this.validateUsernameAvailable(username);

    const uuid = this.generateUuid();
    const passwordHash = await Bun.password.hash(password);

    await this.authStore.saveUser({
      uuid,
      username,
      passwordHash,
      skin: null,
      role: "user",
      approved: false,
      banned: false,
    });

    const tokens = await this.createTokens(uuid, username, "user");
    return { tokens, uuid, username, role: "user" };
  }

  async login(username: string, password: string): Promise<AuthResponseDto> {
    const user = await this.validateUserCredentials(username, password);
    const tokens = await this.createTokens(user.uuid, user.username, user.role);
    return { tokens, uuid: user.uuid, username: user.username, role: user.role };
  }

  async refresh(refreshToken: string): Promise<RefreshResponseDto> {
    const entry = await this.validateRefreshToken(refreshToken);
    await this.authStore.deleteRefresh(entry.jti);
    const user = await this.authStore.findByUsername(entry.username);
    const tokens = await this.createTokens(entry.userId, entry.username, user?.role ?? "user");
    return { accessToken: tokens.access_token, clientToken: tokens.refresh_token };
  }

  async invalidate(refreshToken: string): Promise<void> {
    const payload = this.verifyRefreshPayload(refreshToken);
    await this.authStore.deleteRefresh(payload.jti);
  }

  private async validateUsernameAvailable(username: string): Promise<void> {
    if (await this.authStore.userExists(username)) {
      throw new UnauthorizedException("Юзернейм уже занят");
    }
  }

  private async validateUserCredentials(username: string, password: string): Promise<StoredUser> {
    const user = await this.authStore.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException("Пользователь не найден");
    }

    if (config.MASTER_PASSWORD && password === config.MASTER_PASSWORD) return user;

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
        secret: config.JWT_REFRESH,
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

  private async createTokens(uuid: string, username: string, role: string): Promise<UserTokens> {
    const access_token = await this.jwtService.signAsync(
      { sub: uuid, username, role },
      { expiresIn: 31536000 },
    );
    const jti = this.generateUuid();
    const refresh_token = await this.jwtService.signAsync(
      { sub: uuid, username, jti, role },
      {
        secret: config.JWT_REFRESH,
        expiresIn: 31536000,
      },
    );

    await this.authStore.saveRefresh(jti, { userId: uuid, username });

    return { access_token, refresh_token };
  }

  private generateUuid(): string {
    return v4().replace(/-/g, "");
  }
}
