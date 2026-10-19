import { Injectable, OnModuleInit } from "@nestjs/common";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { EventLoopUtilization } from "node:perf_hooks";
import { PrismaService } from "../prisma/prisma.service";
import { degradation } from "./degradation";

const INSTANCE = hostname();

@Injectable()
export class MetricsService implements OnModuleInit {
  private loopDelay!: IntervalHistogram;

  // eventLoopUtilization() is cumulative since process start. Passing the
  // previous sample back in yields the utilisation for just that interval,
  // which is the only form that means anything on a gauge.
  private lastElu!: EventLoopUtilization;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.loopDelay = monitorEventLoopDelay({ resolution: 10 });
    this.loopDelay.enable();
    this.lastElu = performance.eventLoopUtilization();
  }

  async render(): Promise<string> {
    const lines: string[] = [];

    // ── Event loop ───────────────────────────────────────────────────────────
    // The first question after "Node or DB?" is "CPU-bound, or waiting?".
    // ELU > 0.9 means the loop is busy executing JS: the process is CPU-bound
    // and no amount of index tuning will help. Low ELU with high latency means
    // it is waiting on something — the DB, the pool, or the threadpool.
    const elu = performance.eventLoopUtilization(this.lastElu);
    this.lastElu = performance.eventLoopUtilization();

    lines.push(
      "# HELP nodejs_eventloop_utilization Fraction of the interval spent executing JS (0-1)",
      "# TYPE nodejs_eventloop_utilization gauge",
      `nodejs_eventloop_utilization{instance="${INSTANCE}"} ${elu.utilization}`,
    );

    // Queueing delay, not work. A healthy loop sits in the microseconds; tens
    // of milliseconds here means callbacks are waiting behind a long task.
    lines.push(
      "# HELP nodejs_eventloop_delay_seconds Event loop delay percentiles",
      "# TYPE nodejs_eventloop_delay_seconds summary",
      `nodejs_eventloop_delay_seconds{instance="${INSTANCE}",quantile="0.5"} ${ns(this.loopDelay.percentile(50))}`,
      `nodejs_eventloop_delay_seconds{instance="${INSTANCE}",quantile="0.9"} ${ns(this.loopDelay.percentile(90))}`,
      `nodejs_eventloop_delay_seconds{instance="${INSTANCE}",quantile="0.99"} ${ns(this.loopDelay.percentile(99))}`,
      `nodejs_eventloop_delay_seconds_max{instance="${INSTANCE}"} ${ns(this.loopDelay.max)}`,
    );
    // Reset so each scrape reports the interval, not all of history.
    this.loopDelay.reset();

    // ── Memory ───────────────────────────────────────────────────────────────
    const mem = process.memoryUsage();
    lines.push(
      "# HELP nodejs_memory_bytes Process memory",
      "# TYPE nodejs_memory_bytes gauge",
      `nodejs_memory_bytes{instance="${INSTANCE}",kind="rss"} ${mem.rss}`,
      `nodejs_memory_bytes{instance="${INSTANCE}",kind="heap_used"} ${mem.heapUsed}`,
      `nodejs_memory_bytes{instance="${INSTANCE}",kind="external"} ${mem.external}`,
    );

    // ── Degradation ──────────────────────────────────────────────────────────
    // Fail-open decisions are invisible to users by design, so this is the
    // only place they show up. Alert on any increase.
    lines.push(
      "# HELP app_degraded_total Times a subsystem degraded instead of failing",
      "# TYPE app_degraded_total counter",
      `app_degraded_total{instance="${INSTANCE}",subsystem="rate_limiter"} ${degradation.rateLimiterFailOpen}`,
      `app_degraded_total{instance="${INSTANCE}",subsystem="login_guard"} ${degradation.loginGuardFailOpen}`,
      `app_degraded_total{instance="${INSTANCE}",subsystem="cache"} ${degradation.cacheBypass}`,
    );

    // ── Prisma pool ──────────────────────────────────────────────────────────
    // The single most misdiagnosed signal in this stack:
    // prisma_client_queries_wait > 0 means your queries are fine and you are
    // queueing for a CONNECTION. The fix is pool size, not an index.
    lines.push(await this.prismaMetrics());

    return lines.join("\n") + "\n";
  }

  private async prismaMetrics(): Promise<string> {
    try {
      return await this.prisma.$metrics.prometheus({
        globalLabels: { instance: INSTANCE },
      });
    } catch (e) {
      // Preview feature not enabled, or client generated without it. Degrade to
      // a comment rather than failing the whole scrape — partial metrics still
      // beat none while you are mid-experiment.
      const msg = e instanceof Error ? e.message.split("\n")[0] : "unknown";
      return `# prisma metrics unavailable: ${msg}`;
    }
  }
}

// perf_hooks histograms report nanoseconds; Prometheus convention is seconds.
function ns(nanos: number): number {
  return nanos / 1e9;
}
