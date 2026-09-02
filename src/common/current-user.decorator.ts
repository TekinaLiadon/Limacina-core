import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export interface RequestUser {
  uuid: string;
  username: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as RequestUser;
  },
);
