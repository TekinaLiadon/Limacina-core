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
  UserContentStoreToken,
  isUserContentLimitExceededError,
  type ContentType,
  type IUserContentStore,
} from "./user_content_store";
import type { UserContentUploadResponseDto } from "./dto/dto";
import { unlinkSync } from "node:fs";
import { AppConfigToken } from "../config/app-config.provider";
import type { AppConfigType } from "../config/global-config";
import { YggdrasilStoreToken, type IYggdrasilStore } from "../yggdrasil/service/yggdrasil_store";
import { sanitizeFilePrefix } from "../utils/file-prefix";
import { sanitizePng } from "../utils/png";
import {
  DEFAULT_SKIN_PATH,
  MAX_TEXTURE_BYTES,
  type SkinModel,
  buildDefaultSkinUrl,
  pngStructureErrorMessage,
  sha256Hex,
  textureDimensionsErrorMessage,
} from "../utils/texture";
import { lastById } from "../utils/collection";

export const MAX_MODEL_BYTES = 256 * 1024;

const hasBinaryBytes = (file: Uint8Array): boolean =>
  file.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);

@Injectable()
export class UserContentService {
  private readonly logger = new Logger(UserContentService.name);
  private readonly defaultSkinUrl: string;
  private readonly pathLocks = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(UserContentStoreToken) private readonly store: IUserContentStore,
    @Inject(AppConfigToken) private readonly config: AppConfigType,
    @Optional() @Inject(YggdrasilStoreToken) private readonly profileStore?: IYggdrasilStore,
  ) {
    this.defaultSkinUrl = buildDefaultSkinUrl(config.BASE_URL);
  }

  async uploadSkin(
    userUuid: string,
    username: string,
    file: Uint8Array,
    skinModel?: SkinModel,
  ): Promise<UserContentUploadResponseDto> {
    return this.upload(
      userUuid,
      username,
      file,
      "skin",
      this.config.MAX_SKINS_PER_USER,
      "png",
      "textures",
      skinModel,
    );
  }

  async uploadCape(
    userUuid: string,
    username: string,
    file: Uint8Array,
  ): Promise<UserContentUploadResponseDto> {
    return this.upload(
      userUuid,
      username,
      file,
      "cape",
      this.config.MAX_CAPES_PER_USER,
      "png",
      "capes",
    );
  }

  async uploadModel(
    userUuid: string,
    username: string,
    file: Uint8Array,
  ): Promise<UserContentUploadResponseDto> {
    return this.upload(
      userUuid,
      username,
      file,
      "model",
      this.config.MAX_MODELS_PER_USER,
      "txt",
      "models",
    );
  }

  private async upload(
    userUuid: string,
    username: string,
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

    const stored = type === "model" ? file : sanitizePng(file);
    const hash = sha256Hex(stored);
    const prefix = sanitizeFilePrefix(username, userUuid);
    const filename = `${prefix}-${hash}.${extension}`;
    const url = `${this.config.BASE_URL}/${directory}/${filename}`;
    const filePath = `public/${directory}/${filename}`;

    return this.withPathLock(url, async () => {
      let item: Awaited<ReturnType<IUserContentStore["saveWithinLimit"]>>;
      try {
        item = await this.store.saveWithinLimit(userUuid, url, type, maxPerUser, skinModel);
      } catch (error) {
        if (!isUserContentLimitExceededError(error)) throw error;
        this.logger.warn({ userUuid, type, maxPerUser }, "Upload limit reached");
        throw new BadRequestException(
          `Достигнут лимит загрузки ${this.contentTypeName(type)}: ${maxPerUser}`,
        );
      }

      try {
        await Bun.write(filePath, new Uint8Array(stored));
      } catch (error) {
        await this.rollbackUpload(item.id, type, filePath, url);
        throw error;
      }

      if (type === "cape") {
        try {
          await this.syncProfileTexture(userUuid, { capeUrl: url });
        } catch (error) {
          await this.rollbackUpload(item.id, type, filePath, url);
          throw error;
        }
      }

      this.logger.debug({ userUuid, type, id: item.id }, "Uploaded");
      return { id: item.id, url };
    });
  }

  private async withPathLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.pathLocks.get(filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.pathLocks.set(filePath, chain);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.pathLocks.get(filePath) === chain) this.pathLocks.delete(filePath);
    }
  }

  private async rollbackUpload(
    id: number,
    type: ContentType,
    localPath: string,
    url: string,
  ): Promise<void> {
    try {
      const removed = await this.store.deleteByIdAndCountRemaining(id, type);
      if (!removed || removed.remainingCount > 0) return;
      if (this.profileStore && (await this.profileStore.countProfilesByTextureUrl(url)) > 0) {
        return;
      }
      this.unlinkLocalFile(localPath);
    } catch (error) {
      this.logger.error({ err: error, id, type, localPath }, "Не удалось откатить загрузку");
    }
  }

  private unlinkLocalFile(localPath: string): void {
    try {
      unlinkSync(localPath);
    } catch (error) {
      this.logger.error({ err: error, path: localPath }, "Не удалось удалить файл контента");
    }
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

    const previousActiveId = await this.findActiveSkinId(ownerUuid);

    await this.store.updateActiveSkin(ownerUuid, skinId);
    try {
      await this.syncProfileTexture(ownerUuid, {
        skinUrl: item.filePath,
        skinModel: item.skinModel ?? null,
      });
    } catch (error) {
      await this.restoreActiveSkin(ownerUuid, skinId, previousActiveId);
      throw error;
    }

    this.logger.debug({ ownerUuid, skinId }, "Active skin changed");
  }

  private async findActiveSkinId(ownerUuid: string): Promise<number | undefined> {
    return (await this.store.findByUserUuid(ownerUuid, "skin")).find((skin) => skin.active)?.id;
  }

  private async restoreActiveSkin(
    ownerUuid: string,
    expectedActiveId: number,
    previousActiveId: number | undefined,
  ): Promise<void> {
    try {
      if ((await this.findActiveSkinId(ownerUuid)) !== expectedActiveId) return;

      if (previousActiveId === undefined) {
        await this.store.deactivateAllSkins(ownerUuid);
        return;
      }
      await this.store.updateActiveSkin(ownerUuid, previousActiveId);
    } catch (error) {
      this.logger.error(
        { err: error, ownerUuid, previousActiveId },
        "Не удалось откатить активный скин после сбоя синхронизации профиля",
      );
    }
  }

  private async syncProfileAfterDelete(
    userUuid: string,
    type: ContentType,
    deletedWasActive: boolean,
  ): Promise<void> {
    if (type === "skin") {
      if (!deletedWasActive) return;

      const remaining = await this.store.findByUserUuid(userUuid, "skin");
      const latest = lastById(remaining);
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
      const remaining = await this.store.findByUserUuid(userUuid, "cape");
      const latest = lastById(remaining);
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
    return filePath === this.defaultSkinUrl || filePath === DEFAULT_SKIN_PATH;
  }

  private validatePngFile(file: Uint8Array, type: ContentType): void {
    const contentName = this.contentTypeName(type);
    if (file.length === 0) {
      throw new BadRequestException(`Файл ${contentName} пустой`);
    }
    if (file.length > MAX_TEXTURE_BYTES) {
      throw new BadRequestException(
        `Файл ${contentName} слишком большой: ${file.length} байт (максимум ${MAX_TEXTURE_BYTES})`,
      );
    }

    const invalidMessage = pngStructureErrorMessage(file);
    if (invalidMessage) {
      throw new BadRequestException(`Невалидный файл ${contentName}: ${invalidMessage}`);
    }

    if (type === "skin" || type === "cape") {
      const dimensionMessage = textureDimensionsErrorMessage(file, type);
      if (dimensionMessage) {
        throw new BadRequestException(
          `Недопустимый размер файла ${contentName}: ${dimensionMessage}`,
        );
      }
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

    return this.withPathLock(item.filePath, async () => {
      const removed = await this.store.deleteByIdAndCountRemaining(id, type);
      if (!removed) return;

      const profileRefs = this.profileStore
        ? await this.profileStore.countProfilesByTextureUrl(item.filePath)
        : 0;

      await this.syncProfileAfterDelete(ownerUuid, type, item.active);

      if (removed.remainingCount > 0) {
        this.logger.debug(
          { id, type, remainingCount: removed.remainingCount },
          "Файл контента ещё используется другими записями",
        );
        return;
      }

      if (profileRefs > 0) {
        this.logger.debug(
          { id, type, profileRefs },
          "Файл контента ещё используется профилями Yggdrasil",
        );
        return;
      }

      this.unlinkLocalFile(`public/${item.filePath.replace(`${this.config.BASE_URL}/`, "")}`);

      this.logger.debug({ ownerUuid, type, id }, "Deleted");
    });
  }
}
