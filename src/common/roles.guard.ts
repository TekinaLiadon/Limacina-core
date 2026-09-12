import {
  Logger,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./roles.decorator";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { isKnownRole, roleWeight } from "./roles";

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const unknownRole = requiredRoles.find((role) => !isKnownRole(role));
    if (unknownRole) {
      this.logger.error(
        { unknownRole },
        "В @Roles указана неизвестная роль — доступ закрыт для всех",
      );
      throw new ForbiddenException("Недостаточно прав");
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;
    if (!user) {
      throw new ForbiddenException("Недостаточно прав");
    }

    const userLevel = roleWeight(user.role);
    const hasAccess = requiredRoles.some((role) => userLevel >= roleWeight(role));
    if (!hasAccess) {
      throw new ForbiddenException("Недостаточно прав");
    }

    return true;
  }
}
