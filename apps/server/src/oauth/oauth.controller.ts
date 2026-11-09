import { Controller, Get, Inject, Logger, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import { Public } from '../auth/decorators.js';
import { meta } from '../auth/auth.controller.js';
import { writeSession } from '../auth/session-cookie.js';
import { readCookie } from '../common/cookies.js';
import { ApiData } from '../common/openapi.js';
import { OAuthError, OAuthService } from './oauth.service.js';

const BINDING_PATH = '/api/v1/auth';
const Provider = ApiParam({ name: 'provider', enum: ['google', 'kakao', 'naver'] });

/**
 * 브라우저 리다이렉트 흐름. 결과는 WEB_APP_URL 로 돌려보내며 토큰을 URL 에 싣지 않는다:
 *   성공 → `?auth=success` (refresh 쿠키 설정됨 → 웹이 POST /auth/refresh 로 access token 획득)
 *   실패 → `?auth=error&reason=CANCELLED|STATE_INVALID|PROVIDER_ERROR|NOT_CONFIGURED|…`
 */
@ApiTags('인증')
@Public()
@Controller('auth')
export class OAuthController {
  private readonly logger = new Logger('OAuth');
  constructor(private readonly oauth: OAuthService, @Inject(ENV) private readonly env: Env) {}

  @Get('providers')
  @ApiOperation({ summary: '소셜 로그인 공급자 목록·활성 여부', description: 'Client ID 등이 설정되지 않은 공급자는 enabled=false.' })
  @ApiData(200, '공급자', z.array(z.object({ id: z.enum(['google', 'kakao', 'naver']), name: z.string(), enabled: z.boolean() })))
  providers() {
    return { data: this.oauth.list() };
  }

  @Get(':provider/start')
  @Provider
  @ApiOperation({
    summary: '소셜 로그인 시작(브라우저 이동용)',
    description: 'fetch 가 아니라 브라우저 주소 이동으로 호출한다. 공급자 인증 화면으로 302. state(1회용·10분)·PKCE(Google·카카오)·nonce(Google)를 만든다.',
  })
  @ApiResponse({ status: 302, description: '공급자 인증 페이지 또는 오류 시 웹으로 이동' })
  async start(@Param('provider') provider: string, @Req() req: Request, @Res() res: Response) {
    try {
      const { url, binding } = await this.oauth.start(provider, meta(req));
      res.cookie(this.bindingName(), binding, {
        httpOnly: true,
        secure: this.env.cookieSecure,
        sameSite: 'lax', // 공급자에서 돌아오는 최상위 GET 에 전송되어야 함
        path: BINDING_PATH,
        maxAge: 600_000,
      });
      res.redirect(302, url);
    } catch (err) {
      this.fail(res, err);
    }
  }

  @Get(':provider/callback')
  @Provider
  @ApiOperation({ summary: '소셜 로그인 콜백(공급자가 호출)', description: '공급자 콘솔에 등록할 Redirect URI: {OAUTH_REDIRECT_BASE_URL}/api/v1/auth/{provider}/callback' })
  @ApiResponse({ status: 302, description: '웹으로 이동(성공 시 refresh 쿠키 설정)' })
  async callback(@Param('provider') provider: string, @Query() q: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const binding = readCookie(req.header('cookie'), this.bindingName());
    res.clearCookie(this.bindingName(), { httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax', path: BINDING_PATH });
    try {
      const { result, isNew } = await this.oauth.callback(provider, q, binding, meta(req));
      writeSession(res, this.env, result);
      res.redirect(302, `${this.env.webAppUrl}/?auth=success${isNew ? '&new=1' : ''}`);
    } catch (err) {
      this.fail(res, err);
    }
  }

  private fail(res: Response, err: unknown) {
    const reason = err instanceof OAuthError ? err.reason : 'PROVIDER_ERROR';
    if (!(err instanceof OAuthError) || reason === 'PROVIDER_ERROR') this.logger.warn(`${reason}: ${err instanceof Error ? err.message : err}`);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, `${this.env.webAppUrl}/?auth=error&reason=${reason}`);
  }

  private bindingName() {
    return this.env.cookieSecure ? '__Secure-oy_oauth' : 'oy_oauth';
  }
}
