import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import { readCookie } from '../common/cookies.js';
import { parseInput } from '../common/validation.js';
import { ApiData, ApiErrors, ApiJsonBody } from '../common/openapi.js';
import { MeSchema } from '../users/user.dto.js';
import { AuthPolicy } from './auth.policy.js';
import { AuthService, type ClientMeta } from './auth.service.js';
import { LoginInput, SignupInput } from './auth.dto.js';
import { CurrentUser, Public, RequireOrigin, type AuthUser } from './decorators.js';
import { clearSession, writeSession } from './session-cookie.js';

export const TokenResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().describe('access token 수명(초)'),
  user: MeSchema,
});
const tokenExample = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6ImF0K2p3dCJ9…',
  tokenType: 'Bearer',
  expiresIn: 600,
  user: { id: '019a…', email: 'me@example.com', nickname: null, departmentLabel: null, profileCompleted: false, createdAt: '2026-11-09T10:00:00.000Z' },
};
const credentialsExample = { email: 'me@example.com', password: 'my-password-123' };
const OriginHeader = ApiHeader({
  name: 'Origin',
  required: true,
  description: '쿠키를 쓰는 인증 경로는 허용된 Origin 필수(CSRF 방어). 브라우저(Swagger UI 포함)는 자동으로 보낸다.',
});

/**
 * 응답 본문: { data: { accessToken, tokenType, expiresIn, user } }
 * refresh token 은 본문에 넣지 않고 HttpOnly 쿠키로만 전달한다.
 */
@ApiTags('인증')
@Controller('auth')
export class AuthController {
  private readonly cookieName: string;

  constructor(private readonly auth: AuthService, @Inject(ENV) private readonly env: Env) {
    this.cookieName = AuthPolicy.cookie.name(env.cookieSecure);
  }

  @Public()
  @RequireOrigin()
  @Post('signup')
  @HttpCode(201)
  @ApiOperation({ summary: '이메일 회원가입', description: '성공 시 access token(본문)과 refresh token(HttpOnly 쿠키)을 발급한다. 비밀번호 10–128자.' })
  @OriginHeader
  @ApiJsonBody(SignupInput, credentialsExample)
  @ApiData(201, '가입 및 로그인 완료', TokenResponse, tokenExample)
  @ApiErrors([400, 'VALIDATION_FAILED · MALFORMED_REQUEST'], [403, 'ORIGIN_REJECTED'], [409, 'EMAIL_TAKEN'], [429, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE'])
  async signup(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = parseInput(SignupInput, body);
    return writeSession(res, this.env, await this.auth.signup(input.email, input.password, meta(req)));
  }

  @Public()
  @RequireOrigin()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '이메일 로그인', description: '이메일당 실패 5회/15분, IP당 30회/10분 제한.' })
  @OriginHeader
  @ApiJsonBody(LoginInput, credentialsExample)
  @ApiData(200, '로그인 완료', TokenResponse, tokenExample)
  @ApiErrors([400, 'VALIDATION_FAILED'], [401, 'INVALID_CREDENTIALS'], [403, 'ORIGIN_REJECTED'], [429, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE'])
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = parseInput(LoginInput, body);
    return writeSession(res, this.env, await this.auth.login(input.email, input.password, meta(req)));
  }

  @Public()
  @RequireOrigin()
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth('refresh')
  @ApiOperation({
    summary: 'access token 재발급(refresh 회전)',
    description:
      '본문 없음. 브라우저가 HttpOnly refresh 쿠키를 자동 전송한다(Swagger UI 에서도 같은 출처면 자동). ' +
      '성공 시 쿠키가 새 토큰으로 교체된다. 이미 사용된 토큰을 다시 보내면 탈취로 보고 해당 로그인 세션 전체를 폐기한다.',
  })
  @OriginHeader
  @ApiData(200, '재발급 완료', TokenResponse, tokenExample)
  @ApiErrors([401, 'REFRESH_TOKEN_MISSING · REFRESH_TOKEN_INVALID · REFRESH_TOKEN_REUSED · SESSION_EXPIRED · SESSION_REVOKED'], [403, 'ORIGIN_REJECTED'], [429, 'RATE_LIMITED'])
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return writeSession(res, this.env, await this.auth.refresh(this.readToken(req), meta(req)));
    } catch (err) {
      clearSession(res, this.env); // 실패한 refresh 쿠키는 즉시 제거
      throw err;
    }
  }

  @Public()
  @RequireOrigin()
  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth('refresh')
  @ApiOperation({ summary: '로그아웃(현재 기기)', description: '현재 refresh 세션을 폐기하고 쿠키를 지운다. 멱등. 남은 access token 은 만료까지 유효.' })
  @OriginHeader
  @ApiErrors([403, 'ORIGIN_REJECTED'])
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.readToken(req));
    clearSession(res, this.env);
  }

  /** 모든 기기 로그아웃 (access token 필요). 남은 access token 은 만료(기본 10분)까지 유효. */
  @RequireOrigin()
  @Post('logout-all')
  @HttpCode(200)
  @ApiBearerAuth('access')
  @ApiOperation({ summary: '모든 기기 로그아웃' })
  @OriginHeader
  @ApiData(200, '폐기한 세션 수', z.object({ revokedSessions: z.number().int() }), { revokedSessions: 2 })
  @ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED · TOKEN_INVALID'], [403, 'ORIGIN_REJECTED'])
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const revoked = await this.auth.logoutAll(user.userId);
    clearSession(res, this.env);
    return { data: { revokedSessions: revoked } };
  }

  private readToken(req: Request) {
    return readCookie(req.header('cookie'), this.cookieName);
  }
}

export const meta = (req: Request): ClientMeta => ({ ip: req.ip ?? 'unknown', userAgent: req.header('user-agent') });
