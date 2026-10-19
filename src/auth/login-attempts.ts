import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type Redis from "ioredis";
import { REDIS } from "../redis/redis.module";
import { degradation } from "../metrics/degradation";

export const LOGIN_FAILURES_PER_HOUR = 10;
const WINDOW_SECONDS = 60 * 60;

// Caps FAILED logins per account, wherever they come from. This stops one
// account being guessed at from many IPs — the per-IP limit cannot, because a
// botnet has an IP per attempt. It does NOT stop credential stuffing, which
// tries each leaked pair once across many accounts.
//
// The trade: anyone who knows an email can lock its owner out for up to an
// hour by failing on purpose. Accepted here; the usual escalation is a CAPTCHA
// or an emailed unlock link once the counter trips, rather than a hard block.
@Injectable()
export class LoginAttempts {
  private readonly logger = new Logger(LoginAttempts.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  // Called BEFORE argon2 runs. A locked account then costs nothing to attack:
  // argon2id is ~50-100ms of native work on a 4-thread pool, so letting a
  // guessing run through to verify() would turn it into a CPU exhaustion run.
  async assertNotLocked(email: string): Promise<void> {
    const key = keyFor(email);
    let failures: string | null;
    let ttl: number;
    try {
      [failures, ttl] = await Promise.all([
        this.redis.get(key),
        this.redis.ttl(key),
      ]);
    } catch (e) {
      this.failOpen(e);
      return;
    }

    if (Number(failures ?? 0) >= LOGIN_FAILURES_PER_HOUR) {
      throw new HttpException(
        {
          code: "TOO_MANY_LOGIN_ATTEMPTS",
          message:
            "Too many failed attempts for this account. Try again later.",
          retryAfter: Math.max(1, ttl),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string): Promise<void> {
    const key = keyFor(email);
    try {
      // NX: the window starts at the FIRST failure and is not pushed back by
      // later ones — otherwise a slow trickle of guesses keeps the owner
      // locked out forever.
      await this.redis
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS, "NX")
        .exec();
    } catch (e) {
      this.failOpen(e);
    }
  }

  async clear(email: string): Promise<void> {
    await this.redis.del(keyFor(email)).catch((e: unknown) => this.failOpen(e));
  }

  private failOpen(e: unknown): void {
    degradation.loginGuardFailOpen++;
    const msg = e instanceof Error ? e.message : String(e);
    this.logger.warn(
      `redis unavailable, login attempt limit not enforced: ${msg}`,
    );
  }
}

// Hashed so Redis never holds a list of email addresses — a KEYS * or a
// memory dump would otherwise be a user directory. Normalised so
// "Alice@x.com" and "alice@x.com " share one counter.
function keyFor(email: string): string {
  const h = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `v1:login-fail:${h}`;
}
