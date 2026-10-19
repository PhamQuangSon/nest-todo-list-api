import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import cookieParser from "cookie-parser";
import type { Express } from "express";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { readEnv } from "./config/env";

// Shared by main.ts and the e2e suite so tests exercise the real pipeline
// instead of a bare AppModule.
export function configureApp(app: INestApplication): INestApplication {
  const { corsOrigins, trustProxyHops } = readEnv();

  // Decides what req.ip is, and therefore which bucket the per-IP rate limit
  // charges. Too few hops and every client looks like the proxy (one shared
  // bucket — one abuser locks everyone out). Too many and the client's own
  // X-Forwarded-For is believed (everyone picks their own bucket).
  (app.getHttpAdapter().getInstance() as Express).set(
    "trust proxy",
    trustProxyHops,
  );

  app.use(cookieParser());
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
    exposedHeaders: ["ETag", "Retry-After"],
    credentials: true,
  });

  return app;
}
