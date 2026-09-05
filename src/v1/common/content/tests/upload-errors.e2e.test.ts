process.env["JWT_ACCESS"] = "test-access-secret";
process.env["JWT_REFRESH"] = "test-refresh-secret";
process.env["NODE_ENV"] = "test";
process.env["DB_DRIVER"] = "map";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type INestApplication, Injectable, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import fastifyMultipart from "@fastify/multipart";
import supertest from "supertest";
import { V1ContentController } from "../content.controller";
import { UserContentService } from "../../../../user-content/user-content.service";
import {
  UserContentMapStore,
  UserContentMapStoreToken,
} from "../../../../user-content/user-content.store";
import GlobalConfig from "../../../../config/global-config";
import { AppConfigToken } from "../../../../config/app-config.provider";
import { Jwt_authGuard } from "../../../../common/jwt_auth.guard";
import { RolesGuard } from "../../../../common/roles.guard";
import { AllExceptionsFilter } from "../../../../common/all-exceptions.filter";

const TEST_UUID = "v1upload-uuid-0001";
const FILE_SIZE_LIMIT = 10;

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: "test-access-secret",
    });
  }

  validate(payload: { sub: string; username: string; role: string }) {
    return { uuid: payload.sub, username: payload.username, role: payload.role };
  }
}

describe("V1 common/content — ошибки загрузки файлов", (): void => {
  let app: INestApplication;
  let jwtService: JwtService;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: "test-access-secret",
          signOptions: { expiresIn: 31536000 },
        }),
      ],
      controllers: [V1ContentController],
      providers: [
        UserContentService,
        { provide: AppConfigToken, useFactory: () => GlobalConfig.parseEnvOrExit() },
        TestJwtStrategy,
        {
          provide: UserContentMapStoreToken,
          useClass: UserContentMapStore,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app
      .getHttpAdapter()
      .getInstance()
      .register(fastifyMultipart, { limits: { fileSize: FILE_SIZE_LIMIT } });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new Jwt_authGuard(reflector), new RolesGuard(reflector));
    jwtService = moduleFixture.get(JwtService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    userToken = jwtService.sign({ sub: TEST_UUID, username: "v1upload", role: "user" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("возвращает 406, а не 500, для не-multipart запроса", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/v1/common/content/skins")
      .set("Authorization", `Bearer ${userToken}`)
      .set("Content-Type", "application/json")
      .send("{}");

    expect(res.status).toBe(406);
  });

  it("возвращает 413, а не 500, при превышении лимита размера файла", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/v1/common/content/skins")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("file", Buffer.alloc(FILE_SIZE_LIMIT + 1, "a"), "skin.png");

    expect(res.status).toBe(413);
  });
});
