import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";
import type { RequestUser } from "./current-user.decorator";

export interface JwtAccessPayload {
  sub: string;
  username: string;
  role: string;
  iat?: number;
}

function issuedBeforePasswordChange(
  payload: JwtAccessPayload,
  passwordChangedAt: Date | undefined,
): boolean {
  if (!passwordChangedAt) return false;
  return (payload.iat ?? 0) < Math.floor(passwordChangedAt.getTime() / 1000);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(AppConfigToken) config: AppConfigType,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.JWT_ACCESS,
    });
  }

  async validate(payload: JwtAccessPayload): Promise<RequestUser> {
    const user = await this.authStore.findByUsername(payload.username);
    if (!user || user.uuid !== payload.sub) {
      throw new UnauthorizedException();
    }

    if (user.banned || !user.approved) {
      throw new UnauthorizedException("Нет доступа");
    }

    if (issuedBeforePasswordChange(payload, user.passwordChangedAt)) {
      throw new UnauthorizedException();
    }

    return { uuid: payload.sub, username: payload.username, role: user.role };
  }
}
