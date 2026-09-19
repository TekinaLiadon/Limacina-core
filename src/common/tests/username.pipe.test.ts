import { describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { UsernamePipe } from "../username.pipe";

describe("UsernamePipe", () => {
  const pipe = new UsernamePipe();

  it("пропускает валидный юзернейм из латиницы, цифр и _", () => {
    expect(pipe.transform("john_doe")).toBe("john_doe");
  });

  it("пропускает юзернейм длиной до 64 символов", () => {
    const maxUsername = "a".repeat(64);

    expect(pipe.transform(maxUsername)).toBe(maxUsername);
  });

  it("отклоняет юзернейм длиннее 64 символов", () => {
    expect(() => pipe.transform("a".repeat(65))).toThrow(BadRequestException);
  });

  it("отклоняет юзернейм с пробелами", () => {
    expect(() => pipe.transform("john doe")).toThrow(BadRequestException);
  });

  it("отклоняет юзернейм с кириллицей и unicode", () => {
    expect(() => pipe.transform("джон")).toThrow(BadRequestException);
    expect(() => pipe.transform("john😀")).toThrow(BadRequestException);
  });

  it("отклоняет юзернейм со служебными символами пути", () => {
    expect(() => pipe.transform("john/doe")).toThrow(BadRequestException);
    expect(() => pipe.transform("john..doe")).toThrow(BadRequestException);
  });
});
