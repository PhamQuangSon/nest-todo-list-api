// Set env vars before NestJS ConfigModule loads so validation passes.
// Overrides .env; keeps tests runnable without Docker.
const user = process.env.USER ?? "postgres";
process.env.DATABASE_URL ??= `postgresql://${user}@localhost:5432/todos?connection_limit=5`;
process.env.JWT_SECRET ??= "e2e-test-secret-key-minimum-32-chars!";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
