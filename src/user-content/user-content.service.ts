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

export const MAX_SKIN_BYTES = 512 * 1024;
export const MAX_MODEL_BYTES = 256 * 1024;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SKIN_MODELS = ["classic", "slim"] as const;
export type SkinModel = (typeof SKIN_MODELS)[number];

const hasBinaryBytes = (file: Uint8Array): boolean =>
  file.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);

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
    file: Uint8Array,
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

  async uploadCape(userUuid: string, file: Uint8Array): Promise<UserContentUploadResponseDto> {
    return this.upload(userUuid, file, "cape", this.config.MAX_CAPES_PER_USER, "png", "capes");
  }

  async uploadModel(userUuid: string, file: Uint8Array): Promise<UserContentUploadResponseDto> {
    return this.upload(userUuid, file, "model", this.config.MAX_MODELS_PER_USER, "txt", "models");
  }

  private async upload(
    userUuid: string,
    file: Uint8Array,
    type: ContentType,
    maxPerUser: number,
    extension: string,
    directory: string,
    skinModel?: SkinModel,
  ): Promise<UserContentUploadResponseDto> {
    if (type === "model") {
      this.validateModelFile(file);
    } else {
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

    if (type === "cape") {
      await this.syncProfileTexture(userUuid, { capeUrl: url });
    }

    this.logger.debug({ userUuid, type, id: item.id }, "Uploaded");
    return { id: item.id, url };
  }

  async setActiveSkin(ownerUuid: string, skinId: number): Promise<void> {
    const item = await this.store.findById(skinId, "skin");
    if (!item) throw new NotFoundException("Скин не найден");

    if (item.userUuid !== ownerUuid) {
      this.logger.warn({ ownerUuid, skinId, actualOwner: item.userUuid }, "Ownership mismatch");
      throw new ForbiddenException("Нет прав на смену активного скина");
    }

    if (this.isDefaultSkin("skin", item.filePath)) {
      throw new BadRequestException("Нельзя выбрать дефолтный скин как активный");
    }

    await this.store.updateActiveSkin(ownerUuid, skinId);
    await this.syncProfileTexture(ownerUuid, {
      skinUrl: item.filePath,
      skinModel: item.skinModel ?? null,
    });

    this.logger.debug({ ownerUuid, skinId }, "Active skin changed");
  }

  private async syncProfileAfterDelete(userUuid: string, type: ContentType): Promise<void> {
    if (type === "skin") {
      const remaining = await this.store.findByUserUuid(userUuid, "skin");
      const latest = remaining.toSorted((a, b) => a.id - b.id).at(-1);
      if (latest) {
        await this.store.updateActiveSkin(userUuid, latest.id);
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

  private isDefaultSkin(type: ContentType, filePath: string): boolean {
    if (type !== "skin") return false;
    return filePath === this.defaultSkinUrl || filePath === "/textures/default.png";
  }

  private validatePngFile(file: Uint8Array, type: ContentType): void {
    const contentName = this.contentTypeName(type);
    if (file.length === 0) {
      throw new BadRequestException(`Файл ${contentName} пустой`);
    }
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

  private validateModelFile(file: Uint8Array): void {
    if (file.length === 0) {
      throw new BadRequestException("Файл модели пустой");
    }
    if (file.length > MAX_MODEL_BYTES) {
      throw new BadRequestException(
        `Файл модели слишком большой: ${file.length} байт (максимум ${MAX_MODEL_BYTES})`,
      );
    }

    try {
      new TextDecoder("utf-8", { fatal: true }).decode(file);
    } catch {
      throw new BadRequestException("Файл модели должен быть текстом в кодировке UTF-8");
    }

    if (hasBinaryBytes(file)) {
      throw new BadRequestException("Файл модели содержит недопустимые символы");
    }
  }

  async listSkins(
    userUuid: string,
  ): Promise<Array<{ id: number | null; url: string; model?: string | null; active: boolean }>> {
    const items = await this.store.findByUserUuid(userUuid, "skin");
    if (items.length === 0)
      return [{ id: null, url: this.defaultSkinUrl, model: null, active: true }];

    return items.map((item) => ({
      id: item.id,
      url: item.filePath,
      model: item.skinModel ?? null,
      active: item.active,
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

    if (this.isDefaultSkin(type, item.filePath)) {
      this.logger.warn({ ownerUuid, id }, "Попытка удаления дефолтного скина");
      throw new BadRequestException("Нельзя удалить дефолтный скин");
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
