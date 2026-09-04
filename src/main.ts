import { join, relative, resolve, isAbsolute } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import { ValidationPipe, Logger as NestLogger } from "@nestjs/common";
import { Logger, LoggerErrorInterceptor } from "nestjs-pino";
import GlobalConfig from "./config/global-config";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { registerAuthRateLimit } from "./common/auth-rate-limit";

async function bootstrap() {
  const envConfig = GlobalConfig.parseEnvOrExit();
  const adapterOptions =
    envConfig.TRUST_PROXY && envConfig.TRUST_PROXY.length > 0
      ? { trustProxy: envConfig.TRUST_PROXY }
      : {};
  const app = await NestFactory.create(AppModule, new FastifyAdapter(adapterOptions), {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();

  registerProcessErrorHandlers(logger);
  if (process.env.NODE_ENV === "production") {
    logger.warn = () => undefined;
  }

  const instance = app.getHttpAdapter().getInstance();
  await instance.register(fastifyStatic, {
    root: join(process.cwd(), "public"),
    wildcard: true,
  });

  const panelDir = join(process.cwd(), "public", "panel");
  if (existsSync(panelDir)) {
    await instance.register(
      async (panelInstance: FastifyInstance) => {
        await panelInstance.register(fastifyStatic, {
          root: panelDir,
          wildcard: true,
          decorateReply: false,
        });

        const panelIndexPath = join(panelDir, "index.html");
        panelInstance.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
          try {
            await servePanelFallback(request, reply, panelDir, panelIndexPath);
          } catch (error) {
            logger.error({ err: error, url: request.url }, "Ошибка отдачи panel SPA");
            if (!reply.sent) {
              reply.code(404).send("Not found");
            }
          }
        });
      },
      { prefix: "/panel" },
    );
  }

  const corsOrigins = process.env["CORS_ORIGINS"];
  await instance.register(cors, {
    origin: corsOrigins ? corsOrigins.split(",").map((o) => o.trim()) : true,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  });

  await instance.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  await registerAuthRateLimit(instance, {
    max: envConfig.RATE_LIMIT_AUTH_MAX,
    timeWindow: envConfig.RATE_LIMIT_AUTH_WINDOW,
  });

  logger.log("Идет запуск...", "App");

  const config = new DocumentBuilder()
    .setTitle("Limacina")
    .setDescription(
      "API documentation for Limacina\n\n" +
        "Актуальные эндпоинты расположены под префиксом `/v1` и сгруппированы по потребителю: " +
        "`common_*` (общее для панели и лаунчера), `launcher_*` (лаунчер), `panel_*` (админ-панель). " +
        "Исключение — протокол Yggdrasil (`yggdrasil`): его пути диктуются протоколом authlib-injector " +
        "и живут в корне сервера (`/authserver`, `/sessionserver`, `/api`, метадата — `GET /`). " +
        "Остальные эндпоинты без префикса — legacy (помечены `deprecated`), сохранены для обратной совместимости и не развиваются.",
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
    .addTag("panel_server", "Управление сервером — перезапуск (/v1/panel/server)")
    .addTag(
      "yggdrasil",
      "Minecraft Yggdrasil protocol — пути диктуются протоколом authlib-injector, корень API совпадает с корнем сервера (/, /authserver, /sessionserver, /api)",
    )
    .addTag(
      "legacy",
      "Устаревшие эндпоинты без префикса /v1 — только для обратной совместимости, будут удалены",
    )
    .addTag("auth", "Legacy: прежние /auth-эндпоинты (актуальные — common_auth)")
    .addTag("admin", "Legacy: прежние /admin-эндпоинты (актуальные — panel_*)")
    .addTag("launcher", "Legacy: прежние /launcher-эндпоинты (актуальные — launcher_*)")
    .addTag("files", "Legacy: прежние /files-эндпоинты (актуальные — launcher_files)")
    .addTag("user-content", "Legacy: прежние /user-content-эндпоинты (актуальные — common_content)")
    .addTag("technical", "Legacy: прежние /technical-эндпоинты (актуальные — panel_users)")
    .build();

  const documentFactory = () => markLegacyEndpoints(SwaggerModule.createDocument(app, config));
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
}

function markLegacyEndpoints(document: OpenAPIObject): OpenAPIObject {
  const httpMethods = ["get", "put", "post", "delete", "options", "head", "patch"] as const;
  const yggdrasilPathPrefixes = ["/authserver", "/sessionserver", "/api"];

  const isYggdrasilPath = (path: string): boolean =>
    path === "/" || yggdrasilPathPrefixes.some((prefix) => path.startsWith(prefix));

  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (path.startsWith("/v1") || isYggdrasilPath(path)) continue;

    for (const method of httpMethods) {
      const operation = pathItem?.[method];
      if (operation) {
        operation.deprecated = true;
      }
    }
  }

  return document;
}

function registerProcessErrorHandlers(logger: Logger): void {
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ err: reason }, "Необработанный promise rejection");
  });

  process.on("uncaughtException", (error: Error) => {
    logger.error({ err: error }, "Необработанное исключение");
  });
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

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  new NestLogger("Bootstrap").error(message, stack);
  process.exit(1);
});
