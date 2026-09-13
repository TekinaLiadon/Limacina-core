import { describe, expect, it } from "bun:test";
import { AdminMapStore } from "../admin.store";

const buildUser = (username: string, overrides: Record<string, unknown> = {}) => ({
  uuid: `uuid-${username}`,
  username,
  role: "user",
  approved: true,
  banned: false,
  ...overrides,
});

describe("AdminMapStore — порядок пагинации", (): void => {
  it("searchUsers сортирует по lower(username), tie-break по точному нику", async (): Promise<void> => {
    const store = new AdminMapStore();
    const names = ["BBBuser", "aaAuser", "Aabuser", "ZZuser"];
    for (const username of names) {
      await store.saveUser(buildUser(username));
    }

    const page = await store.searchUsers({ limit: 10, offset: 0 });

    expect(page.items.map((item) => item.username)).toEqual([
      "aaAuser",
      "Aabuser",
      "BBBuser",
      "ZZuser",
    ]);
  });

  it("searchDeletedUsers сортирует по lower(username), tie-break по точному нику", async (): Promise<void> => {
    const store = new AdminMapStore();
    const names = ["BBBuser", "aaAuser", "Aabuser"];
    for (const username of names) {
      await store.saveUser(buildUser(username));
      await store.deleteUser(username);
    }

    const page = await store.searchDeletedUsers({ limit: 10, offset: 0 });

    expect(page.items.map((item) => item.username)).toEqual(["aaAuser", "Aabuser", "BBBuser"]);
  });
});
