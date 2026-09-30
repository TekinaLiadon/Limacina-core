import { setupTestEnv } from "../../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { ConflictException, NotImplementedException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import GlobalConfig from "../../../config/global-config";
import { AuthService } from "../auth.service";
import { AuthProxyStore } from "../auth_proxy_store";

const buildProxyAuthService = (): AuthService =>
  new AuthService(
    new JwtService({}),
    new AuthProxyStore("http://upstream.test"),
    GlobalConfig.parseEnvOrExit(),
  );

describe("AuthService в прокси-режиме", (): void => {
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

describe("AuthProxyStore — мутации не имитируют успех", (): void => {
  const buildStore = (): AuthProxyStore => new AuthProxyStore("http://upstream.test");

  const rejectionOf = async (promise: Promise<unknown>): Promise<NotImplementedException> =>
    (await promise.then(
      (): NotImplementedException | undefined => undefined,
      (error: unknown) => error,
    )) as NotImplementedException;

  it("setApproved/setBanned/updateRole бросают NotImplementedException", async (): Promise<void> => {
    const store = buildStore();

    expect((await rejectionOf(store.setApproved("uuid", true))).getStatus()).toBe(501);
    expect((await rejectionOf(store.setBanned("uuid", true))).getStatus()).toBe(501);
    expect((await rejectionOf(store.updateRole("uuid", "admin"))).getStatus()).toBe(501);
  });

  it("replacePassword/deleteUser/restoreUser/deleteRefreshByUserId бросают NotImplementedException", async (): Promise<void> => {
    const store = buildStore();

    await expect(store.replacePassword("uuid", "hash", new Date())).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(store.deleteUser("uuid")).rejects.toBeInstanceOf(NotImplementedException);
    await expect(store.restoreUser("uuid")).rejects.toBeInstanceOf(NotImplementedException);
    await expect(store.deleteRefreshByUserId("uuid")).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
