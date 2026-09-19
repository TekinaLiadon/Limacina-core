import { ApiProperty } from "@nestjs/swagger";
import { applyDecorators } from "@nestjs/common";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { validationMessages } from "../validation-messages";

export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}

export class UserSuccessResponseDto extends SuccessResponseDto {
  @ApiProperty({ example: "john" })
  username!: string;
}

export function OffsetQuery(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Type(() => Number),
    IsInt({ message: validationMessages.int("offset") }),
    Min(0, { message: validationMessages.min("offset", 0) }),
  );
}

export function LimitQuery(max: number): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Type(() => Number),
    IsInt({ message: validationMessages.int("limit") }),
    Min(1, { message: validationMessages.min("limit", 1) }),
    Max(max, { message: validationMessages.max("limit", max) }),
  );
}
