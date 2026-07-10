import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { v4 } from "uuid";
import { AdminMapStoreToken, type IAdminStore } from "../admin/admin.store";
import { AuthMapStoreToken, type IAuthStore } from "../auth/service/auth_store.service";

@Injectable()
export class TechnicalService {
  private readonly logger = new Logger(TechnicalService.name);

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthMapStoreToken) private readonly authStore: IAuthStore,
  ) {}

  async initOwner(username: string, password: string): Promise<{ uuid: string; username: string }> {
    if (await this.adminStore.hasOwner()) {
      throw new ConflictException("Владелец уже создан");
    }

    if (await this.authStore.userExists(username)) {
      throw new ConflictException("Юзернейм уже занят");
    }

    const uuid = v4().replace(/-/g, "");
    const passwordHash = await Bun.password.hash(password);

    await this.authStore.saveUser({
      uuid,
      username,
      passwordHash,
      skin: null,
      role: "owner",
      approved: true,
      banned: false,
    });

    await this.adminStore.saveUser({
      uuid,
      username,
      role: "owner",
      approved: true,
      banned: false,
    });

    this.logger.log({ username }, "Владелец создан");

    return { uuid, username };
  }
}
