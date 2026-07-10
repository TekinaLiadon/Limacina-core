import {CanActivate, ExecutionContext, ForbiddenException, Injectable} from "@nestjs/common";
import {Reflector} from "@nestjs/core";
import {ROLES_KEY} from "./roles.decorator";
import {IS_PUBLIC_KEY} from "./public.decorator";

const ROLE_HIERARCHY: Record<string, number> = {
    owner: 4,
    admin: 3,
    moderator: 2,
    user: 1,
};

@Injectable()
export class RolesGuard implements CanActivate {
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

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) {
            throw new ForbiddenException("Недостаточно прав");
        }

        const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
        const hasAccess = requiredRoles
            .some((role) => userLevel >= (ROLE_HIERARCHY[role] ?? 0));
        if (!hasAccess) {
            throw new ForbiddenException("Недостаточно прав");
        }

        return true;
    }
}
