import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validateSync, type ValidationError } from "class-validator";
import { RegisterDto, AuthDto, ChangePasswordDto, AuthRefreshDto } from "../../auth/dto/dto";
import { ApproveUserDto, SetRoleDto, UsersQueryDto, V1LogsQueryDto } from "../../admin/dto/dto";
import { LauncherConfigCreateDto } from "../../launcher/dto/dto";
import { InitOwnerDto } from "../../technical/dto/dto";
import { AuthenticateDto, JoinDto } from "../../yggdrasil/dto/dto";

const LATIN_ONLY = /[A-Za-z]/;
const ALLOWED_TERMS = /\b(true|false|ISO|admin|moderator|user|slim|cape|skin|os|arch|id)\b/gi;

function messageText(message: string): string {
  const separator = message.indexOf(":");
  return (separator === -1 ? message : message.slice(separator + 1)).replace(ALLOWED_TERMS, "");
}

function messagesOf(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => {
    const own = Object.values(error.constraints ?? {});
    const nested = error.children ? messagesOf(error.children) : [];
    return [...own, ...nested];
  });
}

function validate<T extends object>(cls: new () => T, payload: object): string[] {
  return messagesOf(validateSync(plainToInstance(cls, payload)));
}

describe("Сообщения валидации DTO на русском", () => {
  it("RegisterDto: username с недопустимыми символами и длиной", () => {
    const errors = validate(RegisterDto, { username: "игрок", password: "pass123" });
    expect(errors).toEqual(["username: только латиница, цифры и _"]);
  });

  it("RegisterDto: короткий username и короткий пароль", () => {
    const errors = validate(RegisterDto, { username: "ab", password: "123" });
    expect(errors).toContain("username: минимум 3 символов");
    expect(errors).toContain("password: минимум 6 символов");
  });

  it("RegisterDto: длинный username и длинный пароль", () => {
    const errors = validate(RegisterDto, {
      username: "a".repeat(17),
      password: "p".repeat(129),
    });
    expect(errors).toContain("username: максимум 16 символов");
    expect(errors).toContain("password: максимум 128 символов");
  });

  it("RegisterDto: username не строка, password не строка", () => {
    const errors = validate(RegisterDto, { username: 123, password: 456 });
    expect(errors).toContain("username: ожидается строка");
    expect(errors).toContain("password: ожидается строка");
  });

  it("AuthDto: пустые поля", () => {
    const errors = validate(AuthDto, { username: "", password: "" });
    expect(errors).toContain("username: не должно быть пустым");
    expect(errors).toContain("password: не должно быть пустым");
  });

  it("ChangePasswordDto: границы длины пароля", () => {
    const errors = validate(ChangePasswordDto, { old_password: "1", new_password: "2" });
    expect(errors).toContain("old_password: минимум 6 символов");
    expect(errors).toContain("new_password: минимум 6 символов");
  });

  it("AuthRefreshDto: refresh_token не строка", () => {
    const errors = validate(AuthRefreshDto, { refresh_token: 123 });
    expect(errors).toEqual(["refresh_token: ожидается строка"]);
  });

  it("ApproveUserDto: approved не boolean", () => {
    const errors = validate(ApproveUserDto, { username: "john", approved: "yes" });
    expect(errors).toContain("approved: ожидается true или false");
  });

  it("SetRoleDto: неизвестная роль", () => {
    const errors = validate(SetRoleDto, { username: "john", role: "superadmin" });
    expect(errors).toEqual(["role: допустимые значения: admin, moderator, user"]);
  });

  it("UsersQueryDto: параметры запроса", () => {
    const errors = validate(UsersQueryDto, { limit: 0, offset: -1, username: "", approved: "x" });
    expect(errors).toContain("limit: минимум 1");
    expect(errors).toContain("offset: минимум 0");
    expect(errors).toContain("username: не должно быть пустым");
    expect(errors).toContain("approved: ожидается true или false");
  });

  it("V1LogsQueryDto: фильтры логов", () => {
    const errors = validate(V1LogsQueryDto, {
      date: "08-07-2026",
      statusCode: 99,
      limit: 1001,
    });
    expect(errors).toContain("date: ожидается дата в формате ISO 8601");
    expect(errors).toContain("statusCode: минимум 100");
    expect(errors).toContain("limit: максимум 1000");
  });

  it("LauncherConfigCreateDto: jvmArgs не массив строк", () => {
    const errors = validate(LauncherConfigCreateDto, {
      projectName: "Cordelia",
      mcVersion: "1.21.1",
      modLoader: "neoforge",
      loaderVersion: "21.1.234",
      jvmArgs: ["ok", 5],
      minMemory: "-Xms512M",
      maxMemory: "-Xmx2560M",
      online: "yes",
    });
    expect(errors).toContain("jvmArgs: каждый элемент должен быть строкой");
    expect(errors).toContain("online: ожидается true или false");
  });

  it("InitOwnerDto: границы полей", () => {
    const errors = validate(InitOwnerDto, { username: "", password: "123" });
    expect(errors).toContain("username: не должно быть пустым");
    expect(errors).toContain("password: минимум 6 символов");
  });

  it("AuthenticateDto: nested agent", () => {
    const errors = validate(AuthenticateDto, {
      agent: { name: 1, version: "one" },
      username: "player1",
      password: "pass",
    });
    expect(errors).toContain("agent.name: ожидается строка");
    expect(errors).toContain("agent.version: ожидается число");
  });

  it("JoinDto: типы полей", () => {
    const errors = validate(JoinDto, { accessToken: 1, selectedProfile: 2, serverId: 3 });
    expect(errors).toContain("accessToken: ожидается строка");
    expect(errors).toContain("selectedProfile: ожидается строка");
    expect(errors).toContain("serverId: ожидается строка");
  });

  it("все сообщения на русском", () => {
    const allCases: [new () => object, object][] = [
      [RegisterDto, { username: "player_2024", password: "pass123" }],
      [AuthDto, { username: "john", password: "secret123" }],
      [ChangePasswordDto, { old_password: "secret123", new_password: "newsecret123" }],
      [AuthRefreshDto, { refresh_token: "token" }],
      [ApproveUserDto, { username: "john", approved: true }],
      [SetRoleDto, { username: "john", role: "user" }],
      [UsersQueryDto, { limit: "abc", offset: "x", username: 5, approved: "maybe" }],
      [
        V1LogsQueryDto,
        { date: "not-a-date", statusCode: "x", url: "", ip: "", limit: "y", offset: "z" },
      ],
      [
        LauncherConfigCreateDto,
        {
          projectName: 1,
          mcVersion: 2,
          modLoader: 3,
          loaderVersion: 4,
          jvmArgs: "nope",
          minMemory: 5,
          maxMemory: 6,
          online: 7,
        },
      ],
      [InitOwnerDto, { username: "owner", password: "securepassword" }],
      [
        AuthenticateDto,
        { username: "player1", password: "secret123", clientToken: "ct", requestUser: true },
      ],
      [JoinDto, { accessToken: "t", selectedProfile: "p", serverId: "s" }],
    ];

    for (const [cls, valid] of allCases) {
      const invalid: Record<string, unknown> = {};
      for (const key of Object.keys(valid)) {
        const value = (valid as Record<string, unknown>)[key];
        if (typeof value === "string") invalid[key] = value.length > 0 ? "" : "x";
        else if (typeof value === "number") invalid[key] = "not-a-number";
        else if (typeof value === "boolean") invalid[key] = "not-a-boolean";
        else invalid[key] = null;
      }
      const messages = messagesOf(validateSync(plainToInstance(cls, invalid)));
      for (const message of messages) {
        expect(LATIN_ONLY.test(messageText(message))).toBe(false);
      }
    }
  });
});
