import { ExecutionContext, Module } from "@nestjs/common";
import { SkipThrottle, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { Plan } from "@prisma/client";
import type Redis from "ioredis";
import { readEnv } from "../config/env";
import type { JwtPayload } from "../auth/auth.types";
import { REDIS } from "../redis/redis.module";
import { FailOpenThrottlerStorage } from "./fail-open.storage";

// Base limits. THROTTLE_SCALE multiplies all of them for load tests.
export const RATE_LIMITS = {
  burstPerSecond: 20,
  freePerMinute: 60,
  paidPerMinute: 600,
  authPerIpPerMinute: 20,
} as const;

export const THROTTLER_NAMES = ["burst", "sustained", "auth-ip"] as const;

// Bare @SkipThrottle() skips only a throttler literally named "default" — with
// named throttlers it skips NOTHING. That silently 429'd every Prometheus
// scrape of /metrics. Built from THROTTLER_NAMES so a new throttler cannot
// reintroduce the bug.
export const SkipAllThrottles = () =>
  SkipThrottle(Object.fromEntries(THROTTLER_NAMES.map((n) => [n, true])));

// Set by JwtAuthGuard, which is registered as a global guard BEFORE the
// throttler, so by the time a throttler runs the user is known (or the route
// is public and there is none).
function userOf(ctx: ExecutionContext): JwtPayload | undefined {
  return ctx.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
}

const isAnonymous = (ctx: ExecutionContext) => !userOf(ctx);
const byUser = (_req: unknown, ctx: ExecutionContext) =>
  userOf(ctx)?.sub ?? "anonymous";

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => {
        const scale = readEnv().throttleScale;

        return {
          // Counters live in Redis, shared by every replica. The default
          // in-memory store gives each replica its own counter, so N replicas
          // behind round-robin allow N times the limit — measured: 60/min
          // became exactly 180 at 3 replicas.
          storage: new FailOpenThrottlerStorage(
            new ThrottlerStorageRedisService(redis),
          ),

          // One counter per (throttler, caller), shared by every route. The
          // library default hashes the controller and handler name into the
          // key, i.e. a separate counter per endpoint — "60/min per user"
          // would quietly become 60/min per user PER ROUTE.
          generateKey: (_ctx, tracker, name) => `${name}:${tracker}`,

          throttlers: [
            // Two windows because one cannot express both: 600/min allows all
            // 600 in the first second, 20/s alone allows 72 000 an hour.
            {
              name: "burst",
              ttl: 1_000,
              limit: RATE_LIMITS.burstPerSecond * scale,
              skipIf: isAnonymous,
              getTracker: byUser,
            },
            {
              name: "sustained",
              ttl: 60_000,
              limit: (ctx) =>
                (userOf(ctx)?.plan === Plan.PAID
                  ? RATE_LIMITS.paidPerMinute
                  : RATE_LIMITS.freePerMinute) * scale,
              skipIf: isAnonymous,
              getTracker: byUser,
            },
            // Per-IP applies only where there is no user to key on: register,
            // login, refresh. Per-IP on the authenticated API would punish
            // every user behind one carrier NAT for each other's traffic. The
            // default tracker groups IPv6 by /64, since one client controls a
            // whole /64 and per-address limits would give it 2^64 buckets.
            {
              name: "auth-ip",
              ttl: 60_000,
              limit: RATE_LIMITS.authPerIpPerMinute * scale,
              skipIf: (ctx) => !isAnonymous(ctx),
            },
          ],
        };
      },
    }),
  ],
})
export class ThrottleModule {}
