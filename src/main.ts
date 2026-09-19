import { join, relative, resolve, isAbsolute, sep } from "path";
import { readFile } from "fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import { ValidationPipe, Logger as NestLogger, type INestApplication } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import GlobalConfig, { type AppConfigType } from "./config/global-config";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { RedisClient } from "bun";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { registerAuthRateLimit } from "./common/auth-rate-limit";
import { registerGlobalRateLimit } from "./common/global-rate-limit";
import { RedisRateLimitStore } from "./common/rate-limit-redis-store";
import { buildCachePrefix } from "./cache/cache.module";
import { buildAdapterOptions } from "./config/adapter-options";
import { registerProcessErrorHandlers } from "./config/process-error-handlers";

export async function bootstrap(): Promise<INestApplication> {
  const envConfig = GlobalConfig.parseEnvOrExit();
  const app = await NestFactory.create(
    AppModule,
    new FastifyAdapter(buildAdapterOptions(envConfig)),
    {
      bufferLogs: true,
    },
  );

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();

  registerProcessErrorHandlers(logger);

  const instance = app.getHttpAdapter().getInstance();
  await instance.register(fastifyStatic, {
    root: join(process.cwd(), "public"),
    wildcard: true,
    dotfiles: "ignore",
  });

  const panelDir = join(process.cwd(), "public", "panel");
  mkdirSync(panelDir, { recursive: true });
  await instance.register(
    async (panelInstance: FastifyInstance) => {
      await panelInstance.register(fastifyStatic, {
        root: panelDir,
        wildcard: true,
        decorateReply: false,
        dotfiles: "ignore",
      });

      const panelIndexPath = join(panelDir, "index.html");
      panelInstance.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          await servePanelFallback(request, reply, panelDir, panelIndexPath);
        } catch (error) {
          logger.error({ err: error, url: request.url }, "Ошибка отдачи panel SPA");
          if (!reply.raw.headersSent) {
            reply.code(404).send("Not found");
          }
        }
      });
    },
    { prefix: "/panel" },
  );

  const corsOrigins = envConfig.CORS_ORIGINS;
  await instance.register(cors, {
    origin: corsOrigins ?? false,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  });

  await instance.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  const rateLimitStore = createRateLimitStore(envConfig);
  if (rateLimitStore) {
    instance.addHook("onClose", async (): Promise<void> => {
      rateLimitStore.close();
    });
  }

  const storeOptions = rateLimitStore ? { store: rateLimitStore } : {};
  await registerGlobalRateLimit(instance, {
    max: envConfig.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: envConfig.RATE_LIMIT_GLOBAL_WINDOW,
    ...storeOptions,
  });

  await registerAuthRateLimit(instance, {
    max: envConfig.RATE_LIMIT_AUTH_MAX,
    ipMax: envConfig.RATE_LIMIT_AUTH_IP_MAX,
    timeWindow: envConfig.RATE_LIMIT_AUTH_WINDOW,
    ...storeOptions,
  });

  logger.log("Идет запуск...", "App");

  const config = new DocumentBuilder()
    .setTitle("Limacina")
    .setDescription(
      "API documentation for Limacina\n\n" +
        "Актуальные эндпоинты расположены под префиксом `/v1` и сгруппированы по потребителю: " +
        "`common_*` (общее для панели и лаунчера), `launcher_*` (лаунчер), `panel_*` (админ-панель). " +
        "Исключение — протокол Yggdrasil (`yggdrasil`): его пути диктуются протоколом authlib-injector " +
        "и живут в корне сервера (`/authserver`, `/sessionserver`, `/api`, метадата — `GET /`).",
    )
    .setVersion("1.1")
    .addSecurity("bearer", { type: "apiKey", name: "Authorization", in: "header" })
    .addTag("common_auth", "Общая авторизация — панель и лаунчер (/v1/common/auth)")
    .addTag("common_content", "Скины и модели пользователей (/v1/common/content)")
    .addTag("launcher_update", "Самообновление лаунчера (/v1/launcher/update)")
    .addTag("launcher_files", "Файлы игры: манифест и моды (/v1/launcher/files)")
    .addTag("launcher_config", "Конфиг лаунчера — чтение (/v1/launcher/config)")
    .addTag("panel_users", "Управление пользователями, включая init-owner (/v1/panel/users)")
    .addTag("panel_logs", "Просмотр логов сервера (/v1/panel/logs)")
    .addTag(
      "panel_launcher",
      "Управление лаунчером и его конфигом — только admin (/v1/panel/launcher)",
    )
    .addTag(
      "panel_server",
      "Управление сервером — перезапуск, RCON-консоль игрового сервера (/v1/panel/server)",
    )
    .addTag(
      "yggdrasil",
      "Minecraft Yggdrasil protocol — пути диктуются протоколом authlib-injector, корень API совпадает с корнем сервера (/, /authserver, /sessionserver, /api)",
    )
    .build();

  let openApiDocument: ReturnType<typeof SwaggerModule.createDocument> | undefined;
  const documentFactory = () => (openApiDocument ??= SwaggerModule.createDocument(app, config));
  await instance.get("/openapi.json", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return documentFactory();
    } catch (error) {
      logger.error({ err: error }, "Ошибка генерации OpenAPI-документа");
      return reply.code(500).send({ statusCode: 500, message: "OpenAPI document unavailable" });
    }
  });
  const scalarHandler = apiReference({
    withFastify: true,
    spec: { url: "/openapi.json" },
  }) as (req: FastifyRequest, res: import("node:http").ServerResponse) => void;
  await instance.get("/docs", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.hijack();
      scalarHandler(request, reply.raw);
    } catch (error) {
      logger.error({ err: error }, "Ошибка Scalar UI");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.end("Docs unavailable");
      }
    }
  });

  await app.listen(envConfig.PORT, "0.0.0.0");
  return app;
}

function createRateLimitStore(envConfig: AppConfigType): RedisRateLimitStore | undefined {
  if (!envConfig.REDIS_URL) return undefined;

  const client = new RedisClient(envConfig.REDIS_URL, { enableOfflineQueue: false });
  return new RedisRateLimitStore(client, `${buildCachePrefix(envConfig)}:rate-limit:`);
}

async function servePanelFallback(
  request: FastifyRequest,
  reply: FastifyReply,
  panelDir: string,
  panelIndexPath: string,
): Promise<void> {
  const relativePath = request.url.split("?")[0]!.replace(/^\/panel/, "") || "/index.html";
  const resolvedPath = resolve(panelDir, `.${relativePath}`);
  const relativeToPanel = relative(panelDir, resolvedPath);

  const hasDotSegment = relativeToPanel
    .split(sep)
    .some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");
  if (hasDotSegment) {
    return reply.code(404).send("Not found");
  }

  const isInsidePanel =
    !!relativeToPanel && !relativeToPanel.startsWith("..") && !isAbsolute(relativeToPanel);
  if (isInsidePanel && (await Bun.file(resolvedPath).exists())) {
    return reply.sendFile(`panel${relativePath}`);
  }

  if (!existsSync(panelIndexPath)) {
    return reply.code(404).send("Not found");
  }

  const html = await readFile(panelIndexPath, "utf-8");
  return reply.type("text/html").send(html);
}

if (import.meta.main) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    new NestLogger("Bootstrap").error(message, stack);
    process.exit(1);
  });
}
