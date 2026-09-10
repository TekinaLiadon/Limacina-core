import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
import { YggdrasilStoreToken, type IYggdrasilStore } from "../yggdrasil/service/yggdrasil_store";

const MAX_SKIN_BYTES = 512 * 1024;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SKIN_MODELS = ["classic", "slim"] as const;
export type SkinModel = (typeof SKIN_MODELS)[number];

@Injectable()
export class UserContentService {
  private readonly logger = new Logger(UserContentService.name);
  private readonly defaultSkinUrl: string;

  constructor(
    @Inject(UserContentMapStoreToken) private readonly store: IUserContentStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
    @Optional() @Inject(YggdrasilStoreToken) private readonly profileStore?: IYggdrasilStore,
  ) {
    this.defaultSkinUrl = `${config.BASE_URL}/textures/default.png`;
  }

  async uploadSkin(
    userUuid: string,
    file: Buffer,
    skinModel?: SkinModel,
  ): Promise<UserContentUploadResponseDto> {
    return this.upload(
      userUuid,
      file,
      "skin",
      this.config.MAX_SKINS_PER_USER,
      "png",
      "textures",
      skinModel,
    );
  }

  async uploadCape(userUuid: string, file: Buffer): Promise<UserContentUploadResponseDto> {
    return this.upload(userUuid, file, "cape", this.config.MAX_CAPES_PER_USER, "png", "capes");
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
    skinModel?: SkinModel,
  ): Promise<UserContentUploadResponseDto> {
    if (type !== "model") {
      this.validatePngFile(file, type);
    }

    const count = await this.store.countByUserUuid(userUuid, type);
    if (count >= maxPerUser) {
      this.logger.warn({ userUuid, type, count, maxPerUser }, "Upload limit reached");
      throw new BadRequestException(
        `Достигнут лимит загрузки ${this.contentTypeName(type)}: ${maxPerUser}`,
      );
    }

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(file));
    const hash = hasher.digest("hex");
    const filename = `${hash}.${extension}`;
    const url = `${this.config.BASE_URL}/${directory}/${filename}`;
    const filePath = `public/${directory}/${filename}`;

    await Bun.write(filePath, new Uint8Array(file));
    const item = await this.store.save(userUuid, url, type, skinModel);

    if (type === "skin") {
      await this.syncProfileTexture(userUuid, { skinUrl: url, skinModel: skinModel ?? null });
    }
    if (type === "cape") {
      await this.syncProfileTexture(userUuid, { capeUrl: url });
    }

    this.logger.debug({ userUuid, type, id: item.id }, "Uploaded");
    return { id: item.id, url };
  }

  private async syncProfileAfterDelete(userUuid: string, type: ContentType): Promise<void> {
    if (type === "skin") {
      const remaining = (await this.store.findByUserUuid(userUuid, "skin")).toSorted(
        (a, b) => a.id - b.id,
      );
      const latest = remaining.at(-1);
      if (latest) {
        await this.syncProfileTexture(userUuid, {
          skinUrl: latest.filePath,
          skinModel: latest.skinModel ?? null,
        });
        return;
      }
      await this.syncProfileTexture(userUuid, { skinUrl: null, skinModel: null });
    }

    if (type === "cape") {
      const remaining = (await this.store.findByUserUuid(userUuid, "cape")).toSorted(
        (a, b) => a.id - b.id,
      );
      const latest = remaining.at(-1);
      if (latest) {
        await this.syncProfileTexture(userUuid, { capeUrl: latest.filePath });
        return;
      }
      await this.syncProfileTexture(userUuid, { capeUrl: null });
    }
  }

  private async syncProfileTexture(
    userUuid: string,
    textures: { skinUrl?: string | null; skinModel?: string | null; capeUrl?: string | null },
  ): Promise<void> {
    if (!this.profileStore) return;

    const profile = await this.profileStore.findProfileByUuid(userUuid);
    if (!profile) return;

    await this.profileStore.updateProfileTexture(userUuid, textures);
    this.logger.debug({ userUuid }, "Profile texture synced");
  }

  private contentTypeName(type: ContentType): string {
    if (type === "skin") return "скинов";
    if (type === "cape") return "плащей";
    return "моделей";
  }

  private validatePngFile(file: Buffer, type: ContentType): void {
    const contentName = this.contentTypeName(type);
    if (file.length > MAX_SKIN_BYTES) {
      throw new BadRequestException(
        `Файл ${contentName} слишком большой: ${file.length} байт (максимум ${MAX_SKIN_BYTES})`,
      );
    }

    const hasPngSignature =
      file.length >= PNG_SIGNATURE.length &&
      PNG_SIGNATURE.every((byte, index) => file[index] === byte);
    if (!hasPngSignature) {
      throw new BadRequestException(`Невалидный файл ${contentName}: отсутствует PNG-сигнатура`);
    }
  }

  async listSkins(
    userUuid: string,
  ): Promise<Array<{ id: number | null; url: string; model?: string | null }>> {
    const items = await this.store.findByUserUuid(userUuid, "skin");
    if (items.length === 0) return [{ id: null, url: this.defaultSkinUrl, model: null }];

    return items.map((item) => ({
      id: item.id,
      url: item.filePath,
      model: item.skinModel ?? null,
    }));
  }

  async listCapes(userUuid: string): Promise<Array<{ id: number; url: string }>> {
    const items = await this.store.findByUserUuid(userUuid, "cape");
    return items.map((item) => ({ id: item.id, url: item.filePath }));
  }

  async listModels(userUuid: string): Promise<Array<{ id: number; url: string }>> {
    const items = await this.store.findByUserUuid(userUuid, "model");
    return items.map((item) => ({ id: item.id, url: item.filePath }));
  }

  async delete(ownerUuid: string, id: number, type: ContentType): Promise<void> {
    const item = await this.store.findById(id, type);
    if (!item) {
      const name = this.contentTypeName(type);
      throw new NotFoundException(`${name.slice(0, -1)} не найден`);
    }

    if (item.userUuid !== ownerUuid) {
      this.logger.warn({ ownerUuid, id, type, actualOwner: item.userUuid }, "Ownership mismatch");
      throw new ForbiddenException("Нет прав на удаление");
    }

    await this.store.deleteById(id, type);

    await this.syncProfileAfterDelete(ownerUuid, type);

    const localPath = `public/${item.filePath.replace(`${this.config.BASE_URL}/`, "")}`;
    try {
      unlinkSync(localPath);
    } catch (error) {
      this.logger.error({ err: error, path: localPath }, "Не удалось удалить файл контента");
    }

    this.logger.debug({ ownerUuid, type, id }, "Deleted");
  }
}
