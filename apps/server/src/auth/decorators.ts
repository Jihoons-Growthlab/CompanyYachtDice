import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AccessClaims } from './token.service.js';

export const IS_PUBLIC = 'auth:public';
/** 전역 JWT 가드 제외 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRE_ORIGIN = 'auth:requireOrigin';
/** 쿠키로 인증되는 엔드포인트: Origin 헤더가 허용 목록과 일치해야 한다(CSRF·로그인 CSRF 방어) */
export const RequireOrigin = () => SetMetadata(REQUIRE_ORIGIN, true);

export type AuthUser = AccessClaims;
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().authUser;
});
