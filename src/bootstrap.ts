import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { readEnv } from "./config/env";

// Shared by main.ts and the e2e suite so tests exercise the real pipeline
// instead of a bare AppModule.
export function configureApp(app: INestApplication): INestApplication {
  const { corsOrigins } = readEnv();

  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

  app.enableCors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "If-Match",
      "Idempotency-Key",
    ],
    exposedHeaders: ["ETag"],
    credentials: true,
  });

  return app;
}
