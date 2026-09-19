import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { InitOwnerDto } from "../dto/dto";

function validateDto(data: Record<string, unknown>): Promise<Record<string, string[]>> {
  return validate(plainToInstance(InitOwnerDto, data)).then((errors) =>
    Object.fromEntries(
      errors.map((error) => [String(error.property), Object.keys(error.constraints ?? {})]),
    ),
  );
}

const VALID_OWNER = {
  token: "a".repeat(64),
  username: "owner",
  password: "securepassword",
};

describe("InitOwnerDto", () => {
  it("принимает валидные данные владельца", async () => {
    const constraints = await validateDto(VALID_OWNER);

    expect(constraints).toEqual({});
  });

  it("принимает юзернейм из латиницы, цифр и _ длиной до 64", async () => {
    const constraints = await validateDto({ ...VALID_OWNER, username: "a".repeat(64) });

    expect(constraints).toEqual({});
  });

  it.each(["owner name", "owner-имя", "owner/name", "owner.name"])(
    "отклоняет юзернейм с недопустимыми символами: %s",
    async (username) => {
      const constraints = await validateDto({ ...VALID_OWNER, username });

      expect(constraints["username"]).toContain("matches");
    },
  );

  it("сохраняет проверку длины пароля", async () => {
    const constraints = await validateDto({ ...VALID_OWNER, password: "123" });

    expect(constraints["password"]).toContain("minLength");
  });
});
