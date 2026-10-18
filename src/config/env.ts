export interface AppEnv {
  port: number;
  corsOrigins: string[];
}

export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const raw_origins =
    typeof raw.CORS_ORIGINS === "string" ? raw.CORS_ORIGINS : "";
  const origins = raw_origins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      "CORS_ORIGINS is required and must list exact origins (comma separated). " +
        'A wildcard is not accepted because credentialed requests reject "*".',
    );
  }

  const wildcard = origins.find((o) => o === "*");
  if (wildcard) {
    throw new Error(
      'CORS_ORIGINS must not contain "*": browsers reject Access-Control-Allow-Origin: * ' +
        "on credentialed requests, which the refresh-token cookie needs.",
    );
  }

  return { ...raw, CORS_ORIGINS: origins.join(",") };
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    port: Number(source.PORT ?? 3000),
    corsOrigins: String(source.CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
