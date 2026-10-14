import { describe, expect, it } from "bun:test";
import { resolveLauncherInstallId } from "../install-id-policy";

const VALID_ID = "v1-0123456789abcdef0123456789abcdef";

describe("resolveLauncherInstallId", () => {
  it("принимает ID формата v1- и 32 hex-символа", () => {
    expect(resolveLauncherInstallId(VALID_ID)).toBe(VALID_ID);
  });

  it("отсутствие заголовка даёт undefined", () => {
    expect(resolveLauncherInstallId(undefined)).toBeUndefined();
    expect(resolveLauncherInstallId("")).toBeUndefined();
  });

  it("отклоняет неверный префикс и длину", () => {
    expect(resolveLauncherInstallId("v2-0123456789abcdef0123456789abcdef")).toBeUndefined();
    expect(resolveLauncherInstallId("v1-0123456789abcdef0123456789abcde")).toBeUndefined();
    expect(resolveLauncherInstallId("v1-0123456789abcdef0123456789abcdef0")).toBeUndefined();
  });

  it("отклоняет не-hex символы и верхний регистр", () => {
    expect(resolveLauncherInstallId("v1-0123456789ABCDEF0123456789abcdef")).toBeUndefined();
    expect(resolveLauncherInstallId("v1-0123456789abcdefgh0123456789abcdef")).toBeUndefined();
  });

  it("отклоняет значения с лишними пробелами", () => {
    expect(resolveLauncherInstallId(` ${VALID_ID}`)).toBeUndefined();
    expect(resolveLauncherInstallId(`${VALID_ID} `)).toBeUndefined();
  });
});
