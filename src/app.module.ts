import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { TodoModule } from "./todo/todo.module";
import { MetricsModule } from "./metrics/metrics.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { validateEnv } from "./config/env";
import { ThrottleModule } from "./throttle/throttle.module";
import { AppThrottlerGuard } from "./throttle/app-throttler.guard";
import { RedisModule } from "./redis/redis.module";
import { UserCacheModule } from "./cache/user-cache";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    UserCacheModule,
    AuthModule,
    TodoModule,
    MetricsModule,
    ThrottleModule,
  ],
  providers: [
    // JwtAuthGuard as APP_GUARD protects every route by default.
    // Routes that don't need auth are marked @Public().
    // Order matters: global guards run in registration order, and the
    // throttler keys authenticated traffic on req.user, which only exists
    // once JwtAuthGuard has run.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
