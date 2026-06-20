import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger, LoggerErrorInterceptor } from "nestjs-pino";
import GlobalConfig from "./config/global-config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  logger.log("Идет запуск...", "App");

  const config = new DocumentBuilder()
    .setTitle("Limacina Core")
    .setDescription("API documentation for Limacina Core")
    .setVersion("1.0")
    .addTag("auth", "Аутентификация и управление токенами")
    .addTag("yggdrasil", "Minecraft Yggdrasil authentication")
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, documentFactory);

  await app.listen(GlobalConfig.parseEnvOrExit().PORT, "0.0.0.0");
}
bootstrap();
