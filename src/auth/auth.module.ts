import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { readEnv } from "../config/env";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./guards/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { LoginAttempts } from "./login-attempts";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: readEnv().jwtSecret,
        signOptions: { expiresIn: "15m" },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, LoginAttempts],
  controllers: [AuthController],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
