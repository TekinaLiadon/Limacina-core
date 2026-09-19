import { BadRequestException } from "@nestjs/common";
import { validationMessages } from "./validation-messages";

export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function validateUsernamePattern(username: string): void {
  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestException(validationMessages.usernamePattern);
  }
}
