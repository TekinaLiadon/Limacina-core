import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import GlobalConfig from "../../../config/global-config";
import { AuthService } from "../auth.service";
import { AuthProxyStore } from "../auth_proxy.service";

const buildProxyAuthService = (): AuthService =>
  new AuthService(
    new JwtService({}),
    new AuthProxyStore("http://upstream.test"),
    GlobalConfig.parseEnvOrExit(),
  );

describe("AuthService в прокси-режиме (TASK-12)", (): void => {
  it("register отвечает 409", async (): Promise<void> => {
    const error = await buildProxyAuthService()
      .register("proxyregister", "password123")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it("login отвечает 401", async (): Promise<void> => {
    const error = await buildProxyAuthService()
      .login("proxylogin", "password123")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
  });
});
