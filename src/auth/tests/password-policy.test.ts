import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { validationMessages } from "../../common/validation-messages";
import { MIN_PASSWORD_LENGTH, validatePasswordPolicy } from "../password-policy";

describe("validatePasswordPolicy", (): void => {
  it("принимает пароль минимальной длины и длиннее", (): void => {
    expect(() => validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
    expect(() => validatePasswordPolicy("secure-password-123")).not.toThrow();
  });

  it("отклоняет пароль на символ короче минимума с русским сообщением", (): void => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);

    expect(() => validatePasswordPolicy(short)).toThrow(BadRequestException);
    expect(() => validatePasswordPolicy(short)).toThrow(
      validationMessages.minLength("password", MIN_PASSWORD_LENGTH),
    );
  });

  it("отклоняет пустой пароль", (): void => {
    expect(() => validatePasswordPolicy("")).toThrow(BadRequestException);
  });
});
