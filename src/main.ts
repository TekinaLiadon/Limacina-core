import { join } from "path";
import { readFile } from "fs/promises";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe } from "@nestjs/common";
import { Logger, LoggerErrorInterceptor } from "nestjs-pino";
import GlobalConfig from "./config/global-config";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  const instance = app.getHttpAdapter().getInstance();
  await instance.register(fastifyStatic, {
    root: join(process.cwd(), "public"),
    wildcard: false,
  });

  await instance.register(
    async (panelInstance: FastifyInstance) => {
      await panelInstance.register(fastifyStatic, {
        root: join(process.cwd(), "public", "panel"),
        wildcard: true,
        decorateReply: false,
      });

      const panelRoot = join(process.cwd(), "public", "panel");
      const panelIndexPath = join(panelRoot, "index.html");
      panelInstance.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
        const relativePath = request.url.split("?")[0]!.replace(/^\/panel/, "") || "/index.html";
        const filePath = join(panelRoot, relativePath);

        if (await Bun.file(filePath).exists()) {
          return reply.sendFile("panel" + relativePath);
        }

        const html = await readFile(panelIndexPath, "utf-8");
        return reply.type("text/html").send(html);
      });
    },
    { prefix: "/panel" },
  );

  const corsOrigins = process.env["CORS_ORIGINS"];
  await instance.register(cors, {
    origin: corsOrigins ? corsOrigins.split(",").map((o) => o.trim()) : true,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  });

  await instance.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  logger.log("Идет запуск...", "App");

  const config = new DocumentBuilder()
    .setTitle("Limacina Core")
    .setDescription("API documentation for Limacina Core")
    .setVersion("1.0")
    .addTag("auth", "Аутентификация и управление токенами")
    .addTag("yggdrasil", "Minecraft Yggdrasil authentication")
    .addTag("admin", "Администрирование пользователей")
    .addTag("launcher", "Обновление лаунчера")
    .addTag("technical", "Технические эндпоинты")
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, documentFactory);

  await app.listen(GlobalConfig.parseEnvOrExit().PORT, "0.0.0.0");
}
bootstrap();
