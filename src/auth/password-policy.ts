import { BadRequestException } from "@nestjs/common";
import { validationMessages } from "../common/validation-messages";

export const MIN_PASSWORD_LENGTH = 6;

export function validatePasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(validationMessages.minLength("password", MIN_PASSWORD_LENGTH));
  }
}
