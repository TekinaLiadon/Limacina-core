import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AdminMapStoreToken, type IAdminStore } from "../admin/admin_store";
import { AuthStoreToken, type IAuthStore } from "../auth/service/auth_store";
import { createAuthUser } from "../auth/service/create-auth-user";
import { writeFileAtomicSync } from "../utils/fs";
import type { InitOwnerResponseDto } from "./dto/dto";

const BOOTSTRAP_TOKEN_FILE = "bootstrap.token";
const BOOTSTRAP_TOKEN_BYTES = 32;

@Injectable()
export class TechnicalBootstrapService {
  private readonly logger = new Logger(TechnicalBootstrapService.name);
  private bootstrapToken: string | null = null;

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthStoreToken) private readonly authStore: IAuthStore,
    @Optional() private readonly bootstrapTokenPath: string = join(
      process.cwd(),
      BOOTSTRAP_TOKEN_FILE,
    ),
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let ownerExists: boolean;
    try {
      ownerExists = await this.adminStore.hasOwner();
    } catch (error) {
      this.logger.error(
        { err: error },
        "Не удалось проверить наличие владельца — bootstrap-токен не обрабатывается",
      );
      return;
    }
    if (ownerExists) {
      await this.removeBootstrapTokenFile();
      return;
    }

    let stored = null;
    try {
      stored = await this.readStoredToken();
    } catch (error) {
      this.logger.error(
        { err: error, path: this.bootstrapTokenPath },
        "Не удалось прочитать файл bootstrap-токена — новый токен не создаётся",
      );
      return;
    }
    if (stored !== null) {
      this.bootstrapToken = stored;
      this.logger.log({ path: this.bootstrapTokenPath }, "Bootstrap-токен загружен из файла");
      return;
    }

    const token = randomBytes(BOOTSTRAP_TOKEN_BYTES).toString("hex");
    try {
      this.writeBootstrapTokenFile(token);
    } catch (error) {
      this.logger.error(
        { err: error, path: this.bootstrapTokenPath },
        "Bootstrap-токен не записан, init-owner недоступен",
      );
      return;
    }
    this.bootstrapToken = token;
    process.stdout.write(
      `Bootstrap-токен для создания владельца (${this.bootstrapTokenPath}):\n${token}\n`,
    );
    this.logger.log({ path: this.bootstrapTokenPath }, "Bootstrap-токен создан");
  }

  async initOwner(
    username: string,
    password: string,
    token: string,
  ): Promise<InitOwnerResponseDto> {
    if (await this.adminStore.hasOwner()) {
      throw new ConflictException("Владелец уже создан");
    }

    const expected = this.bootstrapToken;
    if (expected === null) {
      throw new ForbiddenException("Токен инициализации владельца недоступен");
    }
    if (!this.matchesBootstrapToken(token, expected)) {
      throw new ForbiddenException("Неверный токен инициализации владельца");
    }
    this.bootstrapToken = null;

    try {
      const response = await this.saveOwner(username, password);
      await this.removeBootstrapTokenFile();
      this.logger.log({ username }, "Владелец создан");
      return response;
    } catch (error) {
      this.bootstrapToken = expected;
      throw error;
    }
  }

  private matchesBootstrapToken(provided: string, expected: string): boolean {
    const providedBytes = Buffer.from(provided, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    return (
      providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
    );
  }

  private async readStoredToken(): Promise<string | null> {
    const existing = await readFile(this.bootstrapTokenPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      },
    );
    return existing?.trim() || null;
  }

  private writeBootstrapTokenFile(token: string): void {
    writeFileAtomicSync(this.bootstrapTokenPath, token, { mode: 0o600 });
  }

  private async removeBootstrapTokenFile(): Promise<void> {
    try {
      await unlink(this.bootstrapTokenPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error(
          { err: error, path: this.bootstrapTokenPath },
          "Не удалось удалить файл bootstrap-токена",
        );
      }
    }
  }

  private async saveOwner(username: string, password: string): Promise<InitOwnerResponseDto> {
    const user = await createAuthUser(this.authStore, {
      username,
      password,
      role: "owner",
      approved: true,
    });

    try {
      await this.adminStore.saveUser({
        uuid: user.uuid,
        username: user.username,
        role: user.role,
        approved: user.approved,
        banned: user.banned,
      });
    } catch (error) {
      await this.rollbackAuthUserWithRetry(user.uuid);
      throw error;
    }

    return { uuid: user.uuid, username: user.username };
  }

  private async rollbackAuthUserWithRetry(uuid: string): Promise<void> {
    this.logger.error(
      { uuid },
      "Сбой сохранения владельца в admin-сторе, откатывается auth-запись",
    );
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.authStore.deleteUser(uuid);
        return;
      } catch (error) {
        this.logger.error(
          { err: error, uuid, attempt },
          "Не удалось откатить auth-запись владельца",
        );
        if (attempt < attempts) await Bun.sleep(50 * attempt);
      }
    }
    throw new InternalServerErrorException(
      "Владелец не создан: сбой admin-стора, а откат auth-записи не удался — возможна рассинхронизация auth/admin, требуется ручная проверка",
    );
  }
}
