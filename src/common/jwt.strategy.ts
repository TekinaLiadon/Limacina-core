import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { AuthMapStoreToken } from "../auth/service/auth_store.service";
import type { IAuthStore } from "../auth/service/auth_store.service";
import type { RequestUser } from "./current-user.decorator";

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

  async validate(payload: { sub: string; username: string; role: string }): Promise<RequestUser> {
    const user = await this.authStore.findByUsername(payload.username);
    if (!user || user.banned || user.uuid !== payload.sub) {
      throw new UnauthorizedException();
    }
    return { uuid: payload.sub, username: payload.username, role: user.role };
  }
}
