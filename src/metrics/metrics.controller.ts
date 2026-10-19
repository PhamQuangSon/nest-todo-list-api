import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { SkipAllThrottles } from "../throttle/throttle.module";
import { MetricsService } from "./metrics.service";

// Public and anonymous, so it would otherwise fall under the per-IP auth
// limit: Prometheus scrapes 3 replicas every 5s from one address, which is 36
// requests a minute against a limit of 20 once the counter is shared.
@SkipAllThrottles()
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Prometheus text exposition format. Scraped, not read by humans — but
  // curl-able during a load test, which is how it actually gets used here.
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
