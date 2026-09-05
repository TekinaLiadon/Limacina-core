import { Injectable, Logger } from "@nestjs/common";
import type { IAuthStore, RefreshEntry, StoredUser } from "./auth_store.service";

@Injectable()
export class AuthProxyStore implements IAuthStore {
  private readonly logger = new Logger(AuthProxyStore.name);
  private readonly upstreamUrl: string;

  constructor(upstreamUrl: string) {
    this.upstreamUrl = upstreamUrl.replace(/\/+$/, "");
  }

  async findByUsername(username: string): Promise<StoredUser | undefined> {
    return this.fetchUpstreamUser(username);
  }

  async saveUser(user: StoredUser): Promise<void> {
    this.logger.warn(
      { username: user.username, upstreamUrl: this.upstreamUrl },
      "saveUser в прокси-режиме не реализован — запись не отправлена на upstream",
    );
  }

  async approveUser(uuid: string): Promise<void> {
    this.logger.warn(
      { uuid, upstreamUrl: this.upstreamUrl },
      "approveUser в прокси-режиме не реализован",
    );
  }

  async userExists(username: string): Promise<boolean> {
    return (await this.fetchUpstreamUser(username)) !== undefined;
  }

  async updateSkin(uuid: string, _skin: string): Promise<void> {
    this.logger.warn(
      { uuid, upstreamUrl: this.upstreamUrl },
      "updateSkin в прокси-режиме не реализован",
    );
  }

  async updatePasswordHash(uuid: string, _passwordHash: string, _changedAt: Date): Promise<void> {
    this.logger.warn(
      { uuid, upstreamUrl: this.upstreamUrl },
      "updatePasswordHash в прокси-режиме не реализован",
    );
  }

  async updateRole(uuid: string, role: string): Promise<void> {
    this.logger.warn(
      { uuid, role, upstreamUrl: this.upstreamUrl },
      "updateRole в прокси-режиме не реализован",
    );
  }

  async saveRefresh(jti: string, _entry: RefreshEntry): Promise<void> {
    this.logger.warn(
      { jti, upstreamUrl: this.upstreamUrl },
      "saveRefresh в прокси-режиме не реализован",
    );
  }

  async findRefresh(_jti: string): Promise<RefreshEntry | undefined> {
    return undefined;
  }

  async deleteRefresh(jti: string): Promise<void> {
    this.logger.warn(
      { jti, upstreamUrl: this.upstreamUrl },
      "deleteRefresh в прокси-режиме не реализован",
    );
  }

  async deleteRefreshByUserId(userId: string): Promise<void> {
    this.logger.warn(
      { userId, upstreamUrl: this.upstreamUrl },
      "deleteRefreshByUserId в прокси-режиме не реализован",
    );
  }

  private async fetchUpstreamUser(username: string): Promise<StoredUser | undefined> {
    this.logger.warn(
      { username, upstreamUrl: this.upstreamUrl },
      "проксирование авторизации не реализовано — upstream не запрашивается",
    );
    return undefined;
  }
}
