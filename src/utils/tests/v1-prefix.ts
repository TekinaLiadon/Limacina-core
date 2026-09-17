import type { INestApplication } from "@nestjs/common";
import { V1_API_PREFIX } from "../../v1/v1.module";

export function applyV1ApiPrefix(app: INestApplication): void {
  app.setGlobalPrefix(V1_API_PREFIX);
}
