import { setupTestEnv } from "../../utils/tests/test-env";

setupTestEnv();

import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { FilesListQueryDto } from "../../files/dto/dto";
import { UsersSearchQueryDto, V1LogsQueryDto } from "../../admin/dto/dto";

function validate<T extends object>(dtoClass: new () => T, query: object): string[] {
  return validateSync(plainToInstance(dtoClass, query)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("OffsetLimitQueryDto — общий базовый DTO пагинации", (): void => {
  it("UsersSearchQueryDto держит границу limit 100 и опциональность offset/limit", (): void => {
    expect(validate(UsersSearchQueryDto, {})).toEqual([]);
    expect(validate(UsersSearchQueryDto, { limit: "50", offset: "10" })).toEqual([]);

    expect(validate(UsersSearchQueryDto, { limit: "101" })).toContain("limit: максимум 100");
    expect(validate(UsersSearchQueryDto, { offset: "-1" })).toContain("offset: минимум 0");
    expect(validate(UsersSearchQueryDto, { limit: "abc" })).toContain(
      "limit: ожидается целое число",
    );
  });

  it("V1LogsQueryDto держит границу limit 1000", (): void => {
    expect(validate(V1LogsQueryDto, { limit: "1000" })).toEqual([]);
    expect(validate(V1LogsQueryDto, { limit: "1001" })).toContain("limit: максимум 1000");
    expect(validate(V1LogsQueryDto, { offset: "-1" })).toContain("offset: минимум 0");
  });

  it("FilesListQueryDto держит границу limit 1000", (): void => {
    expect(validate(FilesListQueryDto, { limit: "1000" })).toEqual([]);
    expect(validate(FilesListQueryDto, { limit: "1001" })).toContain("limit: максимум 1000");
    expect(validate(FilesListQueryDto, { offset: "-1" })).toContain("offset: минимум 0");
  });
});
