import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload, AuthTokens } from "./auth.types";
import { Plan } from "@prisma/client";
import { LoginAttempts } from "./login-attempts";

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly loginAttempts: LoginAttempts,
  ) {}

  async register(email: string, password: string): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({
        code: "EMAIL_TAKEN",
        message: "Email already in use",
      });
    }

    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash },
    });

    return this.issueTokenPair(user.id, user.plan, user.tokenVersion);
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    await this.loginAttempts.assertNotLocked(email);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      // Counted for unknown emails too, so the limiter does not behave
      // differently for accounts that exist.
      await this.loginAttempts.recordFailure(email);
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS" });
    }

    await this.loginAttempts.clear(email);
    return this.issueTokenPair(user.id, user.plan, user.tokenVersion);
  }

  async refresh(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = sha256(rawToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: "REFRESH_TOKEN_INVALID" });
    }

    // Reuse detected: this token was already rotated. Revoke the entire family.
    if (session.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ code: "REFRESH_TOKEN_REUSED" });
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
    });

    const raw = generateRefreshToken();
    const newHash = sha256(raw);
    const newSession = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        familyId: session.familyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    // Atomic rotation: mark old token as revoked and link to successor.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: newSession.id },
    });

    const accessToken = this.signAccessToken({
      sub: user.id,
      plan: user.plan,
      tv: user.tokenVersion,
      sid: newSession.id,
    });

    return { accessToken, refreshToken: raw };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = sha256(rawToken);
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(
    userId: string,
    plan: Plan,
    tokenVersion: number,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const raw = generateRefreshToken();
    const tokenHash = sha256(raw);

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    const accessToken = this.signAccessToken({
      sub: userId,
      plan,
      tv: tokenVersion,
      sid: session.id,
    });

    return { accessToken, refreshToken: raw };
  }

  private signAccessToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }
}
