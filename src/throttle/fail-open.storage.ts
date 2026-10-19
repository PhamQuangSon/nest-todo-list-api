import { Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
// Not re-exported from the package root in v6.
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { degradation } from "../metrics/degradation";

const ALLOW: ThrottlerStorageRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

// If the limiter's store is unreachable, let the request through.
//
// The alternative — fail closed — turns a Redis blip into a full API outage
// for every user, to protect against abuse that may not be happening. A rate
// limiter exists to keep the service up; it must not be the thing that takes
// it down. The trade is that during the outage nobody is limited, which is why
// every fail-open is counted and exported: it has to be loud somewhere.
export class FailOpenThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger("RateLimiter");
  private lastLogged = 0;

  constructor(private readonly inner: ThrottlerStorage) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.inner.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (e) {
      degradation.rateLimiterFailOpen++;
      const now = Date.now();
      if (now - this.lastLogged > 10_000) {
        this.lastLogged = now;
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`store unavailable, failing open: ${msg}`);
      }
      return ALLOW;
    }
  }
}
