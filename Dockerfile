# Debian slim rather than alpine: argon2 is a native module and publishes
# prebuilt binaries for glibc, not musl. On alpine it falls back to compiling
# from source and fails without a full toolchain. glibc also matches what most
# production hosts run, so the argon2 cost measured here is representative.
# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Toolchain for any native module that has no prebuilt for this platform.
# Only in the builder stage, which is discarded — the runner stays slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pin pnpm to the version that produced the lockfile. A newer pnpm enforces
# stricter lockfile policies and fails --frozen-lockfile on a valid file.
RUN npm install -g pnpm@9.4.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Generate the Prisma client before compiling: the build imports types from it,
# and without generate the app throws "Client did not initialize yet" at runtime.
COPY prisma ./prisma
RUN pnpm prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN pnpm build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runner

ENV NODE_ENV=production

WORKDIR /app

# Prisma picks its query engine by sniffing the libssl version at RUNTIME. With
# no openssl package present it cannot tell, silently defaults to openssl-1.1.x,
# and then fails to find an engine because the builder generated the
# openssl-3.0.x one. Installing openssl here is what makes the two agree.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Dev dependencies are deliberately NOT pruned. The Prisma CLI lives in
# devDependencies, and the `migrate` service in docker-compose runs
# `prisma migrate deploy` from this same image. Pruning would also risk removing
# the generated client that pnpm stores inside the @prisma/client package.
# Larger image, one image for both jobs — the right trade for a local stack.
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

USER appuser

EXPOSE 3000

# Exec form: PID 1 is node, SIGTERM goes directly to the app.
# Shell form would make sh PID 1 and prevent graceful shutdown.
CMD ["node", "dist/main"]
