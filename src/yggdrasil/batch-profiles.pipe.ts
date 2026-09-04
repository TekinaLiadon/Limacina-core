import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common";

const MAX_PROFILE_NAMES = 10;

@Injectable()
export class BatchProfilesPipe implements PipeTransform {
  transform(value: unknown, _metadata: ArgumentMetadata): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("Ожидается массив имён игроков");
    }

    for (const name of value) {
      if (typeof name !== "string" || name.length === 0) {
        throw new BadRequestException("Имена игроков должны быть непустыми строками");
      }
    }

    return value;
  }
}

export { MAX_PROFILE_NAMES };
