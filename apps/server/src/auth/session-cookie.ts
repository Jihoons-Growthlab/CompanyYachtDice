import type { Response } from 'express';
import type { Env } from '../config/env.js';
import { AuthPolicy } from './auth.policy.js';
import type { AuthResult } from './auth.service.js';

/** refresh 쿠키 설정 + 공통 응답 본문(이메일 로그인·개발 간편 로그인·소셜 콜백 공용) */
export function writeSession(res: Response, env: Env, r: AuthResult) {
  res.cookie(AuthPolicy.cookie.name(env.cookieSecure), r.refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: AuthPolicy.cookie.sameSite,
    path: AuthPolicy.cookie.path,
    maxAge: r.refreshMaxAgeSec * 1000,
  });
  res.setHeader('Cache-Control', 'no-store');
  return { data: { accessToken: r.accessToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, user: r.user } };
}

export function clearSession(res: Response, env: Env) {
  res.clearCookie(AuthPolicy.cookie.name(env.cookieSecure), {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: AuthPolicy.cookie.sameSite,
    path: AuthPolicy.cookie.path,
  });
}
