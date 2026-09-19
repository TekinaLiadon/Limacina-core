import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import {
  AdminMapStoreToken,
  DELETED_USERS_RETENTION_DAYS,
  type IAdminStore,
  type AdminUser,
  type UsersFilter,
  type UsersPage,
  type DeletedUsersPage,
} from "./admin_store";
import { AuthStoreToken, type IAuthStore } from "../auth/service/auth_store";
import { validatePasswordPolicy } from "../auth/password-policy";
import { CronService } from "../cron/cron.service";
import { ROLE_WEIGHTS, isKnownRole } from "../common/roles";
import { isUniqueViolation } from "../utils/sql";
import type { RequestUser } from "../common/current-user.decorator";

interface MutationStep {
  run: () => Promise<void>;
  undo: () => Promise<void>;
}

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(AdminMapStoreToken) private readonly adminStore: IAdminStore,
    @Inject(AuthStoreToken) private readonly authStore: IAuthStore,
    private readonly cron: CronService,
  ) {}

  onModuleInit(): void {
    this.cron.registerTasks({
      name: "purge-old-deleted-users",
      run: () => this.purgeOldDeletedUsers(),
    });
  }

  private async purgeOldDeletedUsers(): Promise<void> {
    const purged = await this.adminStore.purgeOldDeletedUsers(DELETED_USERS_RETENTION_DAYS);
    if (purged > 0) {
      this.logger.log({ purged }, "Просроченные удалённые пользователи очищены");
    }
  }

  async searchUsers(filter: UsersFilter): Promise<UsersPage> {
    return this.adminStore.searchUsers(filter);
  }

  async searchDeletedUsers(filter: UsersFilter): Promise<DeletedUsersPage> {
    return this.adminStore.searchDeletedUsers(filter);
  }

  async setApproved(username: string, approved: boolean, actor: RequestUser): Promise<void> {
    await this.applyUserMutation(username, actor, "approve", "Статус одобрения изменён", (user) =>
      this.buildStorePairSteps(
        {
          run: () => this.adminStore.setApproved(username, approved),
          undo: () => this.adminStore.setApproved(username, user.approved),
        },
        {
          run: () => this.authStore.setApproved(user.uuid, approved),
          undo: () => this.authStore.setApproved(user.uuid, user.approved),
        },
      ),
    );
  }

  async setBanned(username: string, banned: boolean, actor: RequestUser): Promise<void> {
    await this.applyUserMutation(username, actor, "ban", "Статус бана изменён", (user) =>
      this.buildStorePairSteps(
        {
          run: () => this.adminStore.setBanned(username, banned),
          undo: () => this.adminStore.setBanned(username, user.banned),
        },
        {
          run: () => this.authStore.setBanned(user.uuid, banned),
          undo: () => this.authStore.setBanned(user.uuid, user.banned),
        },
      ),
    );
  }

  async setRole(username: string, role: string, actor: RequestUser): Promise<void> {
    if (!this.canAffectRole(actor.role, role)) {
      this.logger.error(
        this.audit(actor, username, "setRole"),
        "Отказ: выдаваемая роль не ниже роли вызывающего",
      );
      throw new ForbiddenException("Невозможно выдать роль, равную или выше собственной");
    }

    await this.applyUserMutation(username, actor, "setRole", "Роль пользователя изменена", (user) =>
      this.buildStorePairSteps(
        {
          run: () => this.adminStore.setRole(username, role),
          undo: () => this.adminStore.setRole(username, user.role),
        },
        {
          run: () => this.authStore.updateRole(user.uuid, role),
          undo: () => this.authStore.updateRole(user.uuid, user.role),
        },
      ),
    );
  }

  async setOwnerRole(username: string, actor: RequestUser): Promise<void> {
    if (actor.role !== "owner") {
      this.logger.error(
        this.audit(actor, username, "setOwner"),
        "Отказ: назначать владельца может только владелец",
      );
      throw new ForbiddenException("Назначать владельца может только владелец");
    }

    const user = await this.adminStore.findByUsername(username);
    if (!user) {
      this.logger.error(this.audit(actor, username, "setOwner"), "Отказ: пользователь не найден");
      throw new NotFoundException(`Пользователь ${username} не найден`);
    }

    await this.applyWithRollback(
      this.buildStorePairSteps(
        {
          run: () => this.adminStore.setRole(username, "owner"),
          undo: () => this.adminStore.setRole(username, user.role),
        },
        {
          run: () => this.authStore.updateRole(user.uuid, "owner"),
          undo: () => this.authStore.updateRole(user.uuid, user.role),
        },
      ),
    );
    this.logger.log(this.audit(actor, username, "setOwner"), "Пользователь назначен владельцем");
  }

  async setUserPassword(username: string, password: string, actor: RequestUser): Promise<void> {
    validatePasswordPolicy(password);

    const user = await this.findMutableUser(username, actor, "setPassword");
    const passwordHash = await Bun.password.hash(password);
    await this.authStore.replacePassword(user.uuid, passwordHash, new Date());
    this.logger.log(this.audit(actor, username, "setPassword"), "Пароль пользователя изменён");
  }

  async deleteUser(username: string, actor: RequestUser): Promise<AdminUser> {
    const user = await this.findMutableUser(username, actor, "delete");
    let deleted: AdminUser | undefined;
    await this.applyWithRollback([
      {
        run: async () => {
          deleted = await this.adminStore.deleteUser(username);
          if (!deleted) {
            this.logger.error(
              this.audit(actor, username, "delete"),
              "Отказ: пользователь не найден",
            );
            throw new NotFoundException(`Пользователь ${username} не найден`);
          }
        },
        undo: async () => {
          await this.adminStore.restoreUser(username);
        },
      },
      {
        run: () => this.authStore.deleteUser(user.uuid),
        undo: () => this.authStore.restoreUser(user.uuid),
      },
      {
        run: () => this.authStore.deleteRefreshByUserId(user.uuid),
        undo: async () => {},
      },
    ]);
    if (!deleted) {
      throw new Error("deleteUser не вернул запись после успешного шага удаления");
    }
    this.logger.log(this.audit(actor, username, "delete"), "Пользователь удалён");
    return deleted;
  }

  async restoreUser(username: string, actor: RequestUser): Promise<void> {
    const deleted = await this.adminStore.findDeletedByUsername(username);
    if (!deleted) {
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: удалённый пользователь не найден",
      );
      throw new NotFoundException(`Удалённый пользователь ${username} не найден`);
    }

    if (!this.canAffectRole(actor.role, deleted.role)) {
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: роль восстанавливаемого не ниже роли вызывающего",
      );
      throw new ForbiddenException(
        "Невозможно восстановить пользователя с равной или более высокой ролью",
      );
    }

    const live = await this.adminStore.findByUsername(username);
    if (live) {
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: юзернейм занят живым пользователем",
      );
      throw new ConflictException(`Юзернейм ${username} уже занят живым пользователем`);
    }

    await this.applyWithRollback([
      {
        run: () => this.adminStore.restoreUser(username),
        undo: async () => {
          await this.adminStore.deleteUser(username);
        },
      },
      {
        run: () => this.authStore.restoreUser(deleted.uuid),
        undo: () => this.authStore.deleteUser(deleted.uuid),
      },
    ]).catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      this.logger.error(
        this.audit(actor, username, "restore"),
        "Отказ: юзернейм занят живым пользователем (гонка с регистрацией)",
      );
      throw new ConflictException(`Юзернейм ${username} уже занят живым пользователем`);
    });

    await this.removeDeletedDuplicatesQuietly(username);
    this.logger.log(this.audit(actor, username, "restore"), "Пользователь восстановлен");
  }

  private async removeDeletedDuplicatesQuietly(username: string): Promise<void> {
    try {
      const removed = await this.adminStore.removeDeletedDuplicates(username);
      if (removed > 0) {
        this.logger.log(
          { username, removed },
          "Устаревшие дубликаты удалённого пользователя подчищены",
        );
      }
    } catch (error) {
      this.logger.error(
        { err: error, username },
        "Не удалось подчистить дубликаты удалённого пользователя",
      );
    }
  }

  private audit(actor: RequestUser, target: string, action: string): Record<string, string> {
    return { actor: actor.username, actorRole: actor.role, target, action };
  }

  private async applyUserMutation(
    username: string,
    actor: RequestUser,
    action: string,
    successMessage: string,
    buildSteps: (user: AdminUser) => MutationStep[],
  ): Promise<void> {
    const user = await this.findMutableUser(username, actor, action);
    await this.applyWithRollback(buildSteps(user));
    this.logger.log(this.audit(actor, username, action), successMessage);
  }

  private buildStorePairSteps(
    admin: { run: () => Promise<void>; undo: () => Promise<void> },
    auth: { run: () => Promise<void>; undo: () => Promise<void> },
  ): MutationStep[] {
    return [
      { run: admin.run, undo: admin.undo },
      { run: auth.run, undo: auth.undo },
    ];
  }

  private async applyWithRollback(steps: MutationStep[]): Promise<void> {
    const applied: MutationStep[] = [];
    try {
      for (const step of steps) {
        await step.run();
        applied.push(step);
      }
    } catch (error) {
      for (const step of applied.reverse()) {
        try {
          await step.undo();
        } catch (undoError) {
          this.logger.error({ err: undoError }, "Откат шага мутации пользователя не выполнен");
        }
      }
      throw error;
    }
  }

  private canAffectRole(callerRole: string, targetRole: string): boolean {
    if (!isKnownRole(callerRole) || !isKnownRole(targetRole)) return false;
    return ROLE_WEIGHTS[callerRole] > ROLE_WEIGHTS[targetRole];
  }

  private async findMutableUser(
    username: string,
    actor: RequestUser,
    action: string,
  ): Promise<AdminUser> {
    const user = await this.adminStore.findByUsername(username);
    if (!user) {
      this.logger.error(this.audit(actor, username, action), "Отказ: пользователь не найден");
      throw new NotFoundException(`Пользователь ${username} не найден`);
    }

    if (!this.canAffectRole(actor.role, user.role)) {
      this.logger.error(
        this.audit(actor, username, action),
        "Отказ: роль цели не ниже роли вызывающего",
      );
      throw new ForbiddenException(
        "Невозможно изменить пользователя с равной или более высокой ролью",
      );
    }

    return user;
  }
}
