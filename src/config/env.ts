export interface AppEnv {
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  redisUrl: string;
  // How many reverse proxies sit in front of the app. Each one appends to
  // X-Forwarded-For, and Express takes the address that many hops from the
  // right. 0 means "trust nothing" — correct when clients connect directly,
  // and the only safe default: trusting a hop that does not exist lets any
  // client pick its own IP by sending the header itself.
  trustProxyHops: number;
  // Multiplies every rate limit. 1 in any real deployment; raised for load
  // tests, where 50 synthetic users generate the traffic of thousands.
  throttleScale: number;
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

  const jwtSecret = typeof raw.JWT_SECRET === "string" ? raw.JWT_SECRET : "";
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      "JWT_SECRET is required and must be at least 32 characters.",
    );
  }

  if (typeof raw.REDIS_URL !== "string" || !raw.REDIS_URL.startsWith("redis")) {
    throw new Error("REDIS_URL is required, e.g. redis://localhost:6382");
  }

  for (const name of ["TRUST_PROXY_HOPS", "THROTTLE_SCALE"] as const) {
    const value = raw[name];
    if (value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || (name === "THROTTLE_SCALE" && n < 1)) {
      throw new Error(
        `${name} must be a non-negative integer (THROTTLE_SCALE >= 1).`,
      );
    }
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
    jwtSecret: String(source.JWT_SECRET ?? ""),
    redisUrl: String(source.REDIS_URL ?? ""),
    trustProxyHops: Number(source.TRUST_PROXY_HOPS || 0),
    throttleScale: Number(source.THROTTLE_SCALE || 1),
  };
}
