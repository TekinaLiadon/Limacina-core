import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { logger } from "./logger/logger.middleware";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter());

  app.use(logger);

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
