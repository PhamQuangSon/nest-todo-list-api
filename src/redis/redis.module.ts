import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from "@nestjs/common";
import Redis from "ioredis";
import { readEnv } from "../config/env";

export const REDIS = Symbol("REDIS");

// Shared by the rate limiter, the login-failure counter and the cache: all
// short commands that tolerate one another. BullMQ (Phase 5) needs its own
// connection — its workers block on BZPOPMIN and would stall everything here.
function createClient(): Redis {
  const logger = new Logger("Redis");
  let lastLogged = 0;

  const client = new Redis(readEnv().redisUrl, {
    // The default queues commands while disconnected and replays them on
    // reconnect. For a cache and a rate limiter that is the wrong failure
    // mode: a Redis outage would make every request HANG instead of failing
    // fast and falling back. Off, a command on a dead connection rejects
    // immediately and the caller degrades.
    enableOfflineQueue: false,
    // Bounds a Redis that is connected but not answering.
    commandTimeout: 200,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    // Keep trying to reconnect forever, backing off to 2s.
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });

  // Without a listener ioredis prints an "Unhandled error event" per failed
  // reconnect attempt. Log, but at most once every 10s.
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastLogged > 10_000) {
      lastLogged = now;
      logger.warn(`redis error: ${err.message}`);
    }
  });
  client.on("ready", () => logger.log("redis ready"));

  return client;
}

// With the offline queue off, any command sent before the first connection
// completes rejects — so the first requests after boot would skip the rate
// limiter. Wait for ready, but only briefly: Redis being down must not stop
// the API from starting, it should start degraded.
async function createReadyClient(): Promise<Redis> {
  const client = createClient();
  const ready = new Promise<void>((resolve) => client.once("ready", resolve));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  await Promise.race([ready, timeout]);
  if (client.status !== "ready") {
    new Logger("Redis").warn(
      "redis not ready after 2s; starting anyway, degraded until it connects",
    );
  }
  return client;
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: createReadyClient }, RedisShutdown],
  exports: [REDIS],
})
export class RedisModule {}
