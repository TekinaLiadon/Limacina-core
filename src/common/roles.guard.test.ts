import { setupTestEnv } from "../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ROLES_KEY } from "./roles.decorator";

const HANDLER = (): void => undefined;
const CONTROLLER = class TestController {};

class StubReflector {
  constructor(private readonly values: Record<string, unknown>) {}

  getAllAndOverride<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

const buildContext = (user: { role: string } | undefined) => {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => HANDLER,
    getClass: () => CONTROLLER,
  } as unknown as ExecutionContext;
};

const buildGuard = (values: Record<string, unknown>): RolesGuard =>
  new RolesGuard(new StubReflector(values) as unknown as Reflector);

describe("RolesGuard", (): void => {
  it("публичный маршрут пропускает без пользователя", (): void => {
    const guard = buildGuard({ [IS_PUBLIC_KEY]: true });
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it("маршрут без @Roles пропускает", (): void => {
    const guard = buildGuard({});
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it("нет пользователя в запросе — Forbidden", (): void => {
    const guard = buildGuard({ [ROLES_KEY]: ["admin"] });
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
  });

  it("роль пользователя ниже требуемой — Forbidden", (): void => {
    const guard = buildGuard({ [ROLES_KEY]: ["admin"] });
    expect(() => guard.canActivate(buildContext({ role: "user" }))).toThrow(ForbiddenException);
  });

  it("роль совпадает — доступ разрешён", (): void => {
    const guard = buildGuard({ [ROLES_KEY]: ["admin"] });
    expect(guard.canActivate(buildContext({ role: "admin" }))).toBe(true);
  });

  it("роль выше требуемой — доступ разрешён", (): void => {
    const guard = buildGuard({ [ROLES_KEY]: ["admin"] });
    expect(guard.canActivate(buildContext({ role: "owner" }))).toBe(true);
  });

  it("неизвестная роль у пользователя — Forbidden", (): void => {
    const guard = buildGuard({ [ROLES_KEY]: ["user"] });
    expect(() => guard.canActivate(buildContext({ role: "hacker" }))).toThrow(ForbiddenException);
  });

  it("неизвестная роль в @Roles запрещает доступ даже владельцу (TASK-18)", (): void => {
    const guard = buildGuard({ [ROLES_KEY]: ["superadmin"] });
    expect(() => guard.canActivate(buildContext({ role: "owner" }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(buildContext({ role: "user" }))).toThrow(ForbiddenException);
  });
});
