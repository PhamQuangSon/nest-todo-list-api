import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { readEnv } from "./config/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const { port } = readEnv();
  await app.listen(port);

  new Logger("Bootstrap").log(`Listening on ${await app.getUrl()}`);
}

void bootstrap();
