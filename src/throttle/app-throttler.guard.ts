import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { ThrottlerLimitDetail } from "@nestjs/throttler/dist/throttler.guard.interface";
import type { Response } from "express";

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // With named throttlers the library only sets `Retry-After-<name>`, which no
  // HTTP client knows to read. Set the standard header as well, so a client can
  // back off for the right amount of time instead of retrying into the wall.
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("Retry-After", Math.max(1, detail.timeToBlockExpire));
    return super.throwThrottlingException(context, detail);
  }
}
