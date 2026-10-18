# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9.4.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN pnpm build

# Remove dev deps so the next stage only copies prod deps
RUN pnpm prune --prod

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules

USER appuser

EXPOSE 3000

# Exec form: PID 1 is node, SIGTERM goes directly to the app.
# Shell form would make sh PID 1 and prevent graceful shutdown.
CMD ["node", "dist/main"]
