import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  UserContentMapStoreToken,
  type ContentType,
  type IUserContentStore,
} from "./user-content.store";
import type { UserContentUploadResponseDto } from "./dto/dto";
import { unlinkSync } from "node:fs";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";

const MAX_SKIN_BYTES = 512 * 1024;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

@Injectable()
export class UserContentService {
  private readonly logger = new Logger(UserContentService.name);
  private readonly defaultSkinUrl: string;

  constructor(
    @Inject(UserContentMapStoreToken) private readonly store: IUserContentStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
  ) {
    this.defaultSkinUrl = `${config.BASE_URL}/textures/default.png`;
  }

  async uploadSkin(userUuid: string, file: Buffer): Promise<UserContentUploadResponseDto> {
    return this.upload(userUuid, file, "skin", this.config.MAX_SKINS_PER_USER, "png", "textures");
  }

  async uploadModel(userUuid: string, file: Buffer): Promise<UserContentUploadResponseDto> {
    return this.upload(userUuid, file, "model", this.config.MAX_MODELS_PER_USER, "txt", "models");
  }

  private async upload(
    userUuid: string,
    file: Buffer,
    type: ContentType,
    maxPerUser: number,
    extension: string,
    directory: string,
  ): Promise<UserContentUploadResponseDto> {
    if (type === "skin") {
      this.validateSkinFile(file);
    }

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
    const url = `${this.config.BASE_URL}/${directory}/${filename}`;
    const filePath = `public/${directory}/${filename}`;

    await Bun.write(filePath, new Uint8Array(file));
    const item = await this.store.save(userUuid, url, type);

    this.logger.debug({ userUuid, type, id: item.id }, "Uploaded");
    return { id: item.id, url };
  }

  private validateSkinFile(file: Buffer): void {
    if (file.length > MAX_SKIN_BYTES) {
      throw new BadRequestException(
        `Файл скина слишком большой: ${file.length} байт (максимум ${MAX_SKIN_BYTES})`,
      );
    }

    const hasPngSignature =
      file.length >= PNG_SIGNATURE.length &&
      PNG_SIGNATURE.every((byte, index) => file[index] === byte);
    if (!hasPngSignature) {
      throw new BadRequestException("Невалидный файл скина: отсутствует PNG-сигнатура");
    }
  }

  async listSkins(userUuid: string): Promise<Array<{ id: number | null; url: string }>> {
    const items = await this.store.findByUserUuid(userUuid, "skin");
    if (items.length === 0) return [{ id: null, url: this.defaultSkinUrl }];

    return items.map((item) => ({ id: item.id, url: item.filePath }));
  }

  async listModels(userUuid: string): Promise<Array<{ id: number; url: string }>> {
    const items = await this.store.findByUserUuid(userUuid, "model");
    return items.map((item) => ({ id: item.id, url: item.filePath }));
  }

  async delete(ownerUuid: string, id: number, type: ContentType): Promise<void> {
    const item = await this.store.findById(id, type);
    if (!item) {
      throw new NotFoundException(`${type === "skin" ? "Скин не найден" : "Модель не найдена"}`);
    }

    if (item.userUuid !== ownerUuid) {
      this.logger.warn({ ownerUuid, id, type, actualOwner: item.userUuid }, "Ownership mismatch");
      throw new ForbiddenException("Нет прав на удаление");
    }

    await this.store.deleteById(id, type);

    const localPath = `public/${item.filePath.replace(`${this.config.BASE_URL}/`, "")}`;
    try {
      unlinkSync(localPath);
    } catch (error) {
      this.logger.error({ err: error, path: localPath }, "Не удалось удалить файл контента");
    }

    this.logger.debug({ ownerUuid, type, id }, "Deleted");
  }
}
