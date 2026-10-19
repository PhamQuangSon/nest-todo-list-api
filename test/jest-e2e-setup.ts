// Set env vars before NestJS ConfigModule loads so validation passes. Values
// already in the environment win, and ConfigModule never overrides them.
// Needs local Postgres on 5432 and the compose Redis on 6382.
const user = process.env.USER ?? "postgres";
process.env.DATABASE_URL ??= `postgresql://${user}@localhost:5432/todos?connection_limit=5`;
process.env.JWT_SECRET ??= "e2e-test-secret-key-minimum-32-chars!";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
// Database 15, not 0: rate-limit counters are shared state now. Tests FLUSHDB
// this one to start from zero, which must never touch the load-test stack's
// counters in database 0.
process.env.REDIS_URL ??= "redis://localhost:6382/15";
