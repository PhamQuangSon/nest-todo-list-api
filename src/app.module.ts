import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { TodoModule } from "./todo/todo.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { validateEnv } from "./config/env";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    TodoModule,
  ],
  providers: [
    // JwtAuthGuard as APP_GUARD protects every route by default.
    // Routes that don't need auth are marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
