import { ConflictException } from "@nestjs/common";
import type { IAuthStore, StoredUser } from "./auth_store";
import { validatePasswordPolicy } from "../password-policy";
import { generateUuid } from "../../utils/uuid";

interface AuthUserDraft {
  username: string;
  password: string;
  role: string;
  approved: boolean;
}

export async function createAuthUser(
  authStore: IAuthStore,
  draft: AuthUserDraft,
): Promise<StoredUser> {
  validatePasswordPolicy(draft.password);

  if (await authStore.userExists(draft.username)) {
    throw new ConflictException("Юзернейм уже занят");
  }

  const user: StoredUser = {
    uuid: generateUuid(),
    username: draft.username,
    passwordHash: await Bun.password.hash(draft.password),
    role: draft.role,
    approved: draft.approved,
    banned: false,
  };

  const saved = await authStore.saveUser(user);
  if (!saved) {
    throw new ConflictException("Юзернейм уже занят");
  }
  return user;
}
