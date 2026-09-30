import { Injectable, Logger, NotImplementedException } from "@nestjs/common";
import type { IAuthStore, RefreshEntry, StoredUser } from "./auth_store";

const UNSUPPORTED_MESSAGE =
  "Прокси-режим авторизации не поддерживает мутации — режим не реализован";

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

  async saveUser(user: StoredUser): Promise<boolean> {
    this.logger.warn(
      { username: user.username, upstreamUrl: this.upstreamUrl },
      "saveUser в прокси-режиме не реализован — запись не отправлена на upstream",
    );
    return false;
  }

  async setApproved(uuid: string, approved: boolean, _expectedRole?: string): Promise<boolean> {
    this.warnUnsupported("setApproved", { uuid, approved });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  async setBanned(uuid: string, banned: boolean, _expectedRole?: string): Promise<boolean> {
    this.warnUnsupported("setBanned", { uuid, banned });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  async userExists(username: string): Promise<boolean> {
    return (await this.fetchUpstreamUser(username)) !== undefined;
  }

  async replacePassword(uuid: string, _passwordHash: string, _changedAt: Date): Promise<void> {
    this.warnUnsupported("replacePassword", { uuid });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  async updateRole(uuid: string, role: string, _expectedRole?: string): Promise<boolean> {
    this.warnUnsupported("updateRole", { uuid, role });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  async deleteUser(uuid: string): Promise<void> {
    this.warnUnsupported("deleteUser", { uuid });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  async restoreUser(uuid: string): Promise<void> {
    this.warnUnsupported("restoreUser", { uuid });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  async saveRefresh(jti: string, _entry: RefreshEntry, _expiresAt: Date): Promise<void> {
    this.logger.warn(
      { jti, upstreamUrl: this.upstreamUrl },
      "saveRefresh в прокси-режиме не реализован",
    );
  }

  async claimRefresh(_jti: string): Promise<RefreshEntry | undefined> {
    return undefined;
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
    this.warnUnsupported("deleteRefreshByUserId", { userId });
    throw new NotImplementedException(UNSUPPORTED_MESSAGE);
  }

  private warnUnsupported(operation: string, details: Record<string, unknown>): void {
    this.logger.warn(
      { operation, ...details, upstreamUrl: this.upstreamUrl },
      `${operation} в прокси-режиме не реализован`,
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
