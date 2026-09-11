import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { validationMessages } from "./validation-messages";

const MAX_USERNAME_LENGTH = 64;

@Injectable()
export class UsernamePipe implements PipeTransform {
  transform(value: string): string {
    if (value.length > MAX_USERNAME_LENGTH) {
      throw new BadRequestException(validationMessages.maxLength("username", MAX_USERNAME_LENGTH));
    }
    return value;
  }
}
