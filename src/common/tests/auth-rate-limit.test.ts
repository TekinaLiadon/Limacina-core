import { describe, expect, it } from "bun:test";
import { isAuthLoginRoute, isPasswordChangeRoute, isSignoutRoute } from "../auth-rate-limit";

describe("auth-rate-limit route matchers", () => {
  it("isSignoutRoute матчит только /authserver/signout", () => {
    expect(isSignoutRoute("/authserver/signout")).toBe(true);
    expect(isSignoutRoute("/authserver/signout?x=1")).toBe(true);
    expect(isSignoutRoute("/authserver/authenticate")).toBe(false);
    expect(isSignoutRoute("/authserver/refresh")).toBe(false);
    expect(isSignoutRoute("/v1/common/auth/login")).toBe(false);
    expect(isSignoutRoute("/authserver/signout/")).toBe(false);
  });

  it("isAuthLoginRoute матчит login и registration", () => {
    expect(isAuthLoginRoute("/v1/common/auth/login")).toBe(true);
    expect(isAuthLoginRoute("/v1/common/auth/registration")).toBe(true);
    expect(isAuthLoginRoute("/v1/common/auth/login?x=1")).toBe(true);
    expect(isAuthLoginRoute("/v1/common/auth/password")).toBe(false);
    expect(isAuthLoginRoute("/authserver/signout")).toBe(false);
  });

  it("isAuthLoginRoute не ловит коллизии префикса и суффикса", () => {
    expect(isAuthLoginRoute("/v1/common/authX/login")).toBe(false);
    expect(isAuthLoginRoute("/v1/common/auth/legacy/login")).toBe(false);
    expect(isAuthLoginRoute("/v1/common/auth/login/extra")).toBe(false);
    expect(isAuthLoginRoute("/v1/common/auth/registration-old")).toBe(false);
  });

  it("isPasswordChangeRoute матчит только смену пароля", () => {
    expect(isPasswordChangeRoute("/v1/common/auth/password")).toBe(true);
    expect(isPasswordChangeRoute("/v1/common/auth/password?x=1")).toBe(true);
    expect(isPasswordChangeRoute("/v1/common/auth/login")).toBe(false);
    expect(isPasswordChangeRoute("/authserver/signout")).toBe(false);
  });

  it("isPasswordChangeRoute не ловит коллизии префикса и суффикса", () => {
    expect(isPasswordChangeRoute("/v1/common/authX/password")).toBe(false);
    expect(isPasswordChangeRoute("/v1/common/auth/reset-password")).toBe(false);
    expect(isPasswordChangeRoute("/v1/common/auth/password/old")).toBe(false);
  });
});
