import { BadRequestException } from "@nestjs/common";
import { validationMessages } from "./validation-messages";

export function enumPipeExceptionFactory(
  field: string,
  allowed: readonly string[],
): () => BadRequestException {
  return () => new BadRequestException(validationMessages.enum(field, allowed.join(", ")));
}

export function intPipeExceptionFactory(field: string): () => BadRequestException {
  return () => new BadRequestException(validationMessages.int(field));
}
