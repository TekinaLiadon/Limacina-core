import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  const logger: Logger = app.get(Logger);
  logger.log("Идет запуск...", "App");

  const config = new DocumentBuilder()
    .setTitle("Example")
    .setDescription("The API description")
    .setVersion("1.0")
    .addTag("example")
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, documentFactory);

  await app.listen(process.env["PORT"] ?? 3000, "0.0.0.0");
}
bootstrap();
