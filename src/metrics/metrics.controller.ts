import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { MetricsService } from "./metrics.service";

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
