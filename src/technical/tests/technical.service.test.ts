import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { ConflictException } from "@nestjs/common";
import { TechnicalService } from "../technical.service";
import { AdminMapStore } from "../../admin/admin.store";
import { AuthMapStore } from "../../auth/service/auth_store.service";

describe("TechnicalService", (): void => {
  describe("initOwner", () => {
    it("создаёт владельца и возвращает uuid с юзернеймом", async () => {
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const service = new TechnicalService(adminStore, authStore);

      const result = await service.initOwner("owner", "securepassword");

      expect(result.username).toBe("owner");
      expect(result.uuid).toHaveLength(32);
      expect(await adminStore.hasOwner()).toBe(true);
      expect((await adminStore.findByUsername("owner"))?.role).toBe("owner");
      expect((await authStore.findByUsername("owner"))?.role).toBe("owner");
    });

    it("возвращает 409 если владелец уже создан", async () => {
      const adminStore = new AdminMapStore();
      const authStore = new AuthMapStore();
      const service = new TechnicalService(adminStore, authStore);
      await service.initOwner("firstowner", "securepassword");

      await expect(service.initOwner("secondowner", "securepassword")).rejects.toThrow(
        ConflictException,
      );
      await expect(service.initOwner("secondowner", "securepassword")).rejects.toThrow(
        "Владелец уже создан",
      );
    });

    it("возвращает 409 если юзернейм занят", async () => {
      const authStore = new AuthMapStore();
      await authStore.saveUser({
        uuid: "taken-username-uuid",
        username: "occupied",
        passwordHash: "hash",
        skin: null,
        role: "user",
        approved: true,
        banned: false,
      });
      const service = new TechnicalService(new AdminMapStore(), authStore);

      await expect(service.initOwner("occupied", "securepassword")).rejects.toThrow(
        "Юзернейм уже занят",
      );
    });
  });

  describe("buildBinary", () => {
    it("собирает бинарник через bun run build", async () => {
      const service = new TechnicalService(new AdminMapStore(), new AuthMapStore());
      await service.buildBinary();
      expect(existsSync("dist/Limacina")).toBe(true);
    });
  });
});
