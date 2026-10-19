import { Global, Inject, Injectable, Logger, Module } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../redis/redis.module";
import { degradation } from "../metrics/degradation";

export const cacheStats = { hits: 0, misses: 0 };

// Generation keys outlive every data key, so a generation number is never
// reused while entries written under it can still be read.
const GENERATION_TTL_SECONDS = 24 * 60 * 60;

// Per-user read-through cache, invalidated by a generation counter.
//
// The hard part of caching a list is that one user has many cached variants —
// every cursor, every limit — and enumerating them to delete on write would
// need SCAN, which is O(keyspace) and never belongs on a request path. Instead
// every key embeds the user's current generation:
//
//   v1:u:<userId>:g<gen>:<variant>
//
// and a write just INCRs the generation. One O(1) command orphans every
// variant at once; the orphans expire on their own TTL.
//
// Leak-proof by construction: there is no method that builds a key without a
// userId, so a global key — the cross-tenant leak Phase 0 found — cannot be
// written through this class.
//
// Ordering is what makes it correct under concurrency:
//   reads:  GET generation  -> load from Postgres -> SET under that generation
//   writes: commit to Postgres -> INCR generation
// A reader that raced a write either saw the old generation (and its SET lands
// under a key no one will read again) or the new one (in which case its load
// ran after the commit). Swap either pair and stale data gets cached under the
// live generation.
@Injectable()
export class UserCache {
  private readonly logger = new Logger(UserCache.name);
  private lastLogged = 0;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  // Values come back JSON round-tripped on a hit: a Date is an ISO string. Fine
  // for a response body; do not use a cached value for logic.
  async getOrLoad<T>(
    userId: string,
    variant: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<T> {
    let key: string;
    try {
      const gen = (await this.redis.get(generationKey(userId))) ?? "0";
      key = `v1:u:${userId}:g${gen}:${variant}`;
      const hit = await this.redis.get(key);
      if (hit !== null) {
        cacheStats.hits++;
        return JSON.parse(hit) as T;
      }
    } catch (e) {
      // Redis down: serve from Postgres. Slower, never an error.
      this.bypass(e);
      return load();
    }

    cacheStats.misses++;
    const value = await load();
    // Not awaited: the response does not need to wait for the cache write.
    this.redis
      .set(key, JSON.stringify(value), "EX", ttlSeconds)
      .catch((e: unknown) => this.bypass(e));
    return value;
  }

  // Call AFTER the write has committed. If Redis is unreachable the
  // generation does not move, and entries cached before the write can be
  // served until their TTL runs out — which is why every entry has a short one.
  async invalidate(userId: string): Promise<void> {
    const key = generationKey(userId);
    try {
      await this.redis
        .multi()
        .incr(key)
        .expire(key, GENERATION_TTL_SECONDS)
        .exec();
    } catch (e) {
      this.bypass(e);
    }
  }

  private bypass(e: unknown): void {
    degradation.cacheBypass++;
    const now = Date.now();
    if (now - this.lastLogged > 10_000) {
      this.lastLogged = now;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`redis unavailable, bypassing cache: ${msg}`);
    }
  }
}

function generationKey(userId: string): string {
  return `v1:u:${userId}:gen`;
}

@Global()
@Module({ providers: [UserCache], exports: [UserCache] })
export class UserCacheModule {}
