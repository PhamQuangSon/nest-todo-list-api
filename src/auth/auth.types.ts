import { Plan } from "@prisma/client";

export interface JwtPayload {
  sub: string; // userId
  plan: Plan;
  tv: number; // tokenVersion — bump to revoke all tokens for this user
  sid: string; // sessionId — ties access token to a specific refresh session
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
