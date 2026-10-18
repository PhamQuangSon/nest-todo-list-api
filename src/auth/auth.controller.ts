import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { Public } from "./decorators/public.decorator";

const COOKIE_NAME = "refresh_token";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none" as const,
  path: "/api/v1/auth/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@Public()
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.auth.register(
      dto.email,
      dto.password,
    );
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);
    return { accessToken };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.auth.login(
      dto.email,
      dto.password,
    );
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);
    return { accessToken };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (!raw) {
      res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
      throw new UnauthorizedException({ code: "NO_REFRESH_TOKEN" });
    }
    const { accessToken, refreshToken } = await this.auth.refresh(raw);
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);
    return { accessToken };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (raw) {
      await this.auth.logout(raw);
    }
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  }
}
