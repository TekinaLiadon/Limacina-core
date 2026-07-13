import { unlinkSync } from "node:fs";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { IUserContentStore, ContentType } from "./user-content.store";
import { UserContentMapStoreToken } from "./user-content.store";
import GlobalConfig from "../config/global-config";

const config = GlobalConfig.parseEnvOrExit();
const DEFAULT_SKIN_URL = `${config.BASE_URL}/textures/default.png`;

@Injectable()
export class UserContentService {
  private readonly logger = new Logger(UserContentService.name);

  constructor(@Inject(UserContentMapStoreToken) private readonly store: IUserContentStore) {}

  async uploadSkin(userUuid: string, file: Buffer): Promise<{ id: number; url: string }> {
    return this.upload(userUuid, file, "skin", config.MAX_SKINS_PER_USER, "png", "textures");
  }

  async uploadModel(userUuid: string, file: Buffer): Promise<{ id: number; url: string }> {
    return this.upload(userUuid, file, "model", config.MAX_MODELS_PER_USER, "txt", "models");
  }

  private async upload(
    userUuid: string,
    file: Buffer,
    type: ContentType,
    maxPerUser: number,
    extension: string,
    directory: string,
  ): Promise<{ id: number; url: string }> {
    const count = await this.store.countByUserUuid(userUuid, type);
    if (count >= maxPerUser) {
      this.logger.warn({ userUuid, type, count, maxPerUser }, "Upload limit reached");
      throw new BadRequestException(
        `Достигнут лимит загрузки ${type === "skin" ? "скинов" : "моделей"}: ${maxPerUser}`,
      );
    }

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(file));
    const hash = hasher.digest("hex");
    const filename = `${hash}.${extension}`;
    const url = `${config.BASE_URL}/${directory}/${filename}`;
    const filePath = `public/${directory}/${filename}`;

    await Bun.write(filePath, new Uint8Array(file));
    const item = await this.store.save(userUuid, url, type);

    this.logger.debug({ userUuid, type, id: item.id }, "Uploaded");
    return { id: item.id, url };
  }

  async listSkins(userUuid: string): Promise<Array<{ id: number | null; url: string }>> {
    const items = await this.store.findByUserUuid(userUuid, "skin");
    if (items.length === 0) return [{ id: null, url: DEFAULT_SKIN_URL }];

    return items.map((item) => ({ id: item.id, url: item.filePath }));
  }

  async listModels(userUuid: string): Promise<Array<{ id: number; url: string }>> {
    const items = await this.store.findByUserUuid(userUuid, "model");
    return items.map((item) => ({ id: item.id, url: item.filePath }));
  }

  async delete(ownerUuid: string, id: number, type: ContentType): Promise<void> {
    const item = await this.store.findById(id, type);
    if (!item) {
      throw new BadRequestException(`${type === "skin" ? "Скин" : "Модель"} не найдена`);
    }

    if (item.userUuid !== ownerUuid) {
      this.logger.warn({ ownerUuid, id, type, actualOwner: item.userUuid }, "Ownership mismatch");
      throw new ForbiddenException("Нет прав на удаление");
    }

    await this.store.deleteById(id, type);

    const localPath = `public/${item.filePath.replace(`${config.BASE_URL}/`, "")}`;
    unlinkSync(localPath);

    this.logger.debug({ ownerUuid, type, id }, "Deleted");
  }
}
