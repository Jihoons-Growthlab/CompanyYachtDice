import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, isAllowedOrigin, type Env } from '../config/env.js';
import { Errors } from '../common/app-error.js';
import { IS_PUBLIC, REQUIRE_ORIGIN } from './decorators.js';
import { TokenService } from './token.service.js';

/** 전역 가드: @Public 이 아니면 `Authorization: Bearer <access>` 필수. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // WebSocket 은 gateway handshake 에서 별도 검증(P3)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { authUser?: unknown }>();
    const token = bearer(req.header('authorization'));
    if (!token) throw Errors.authRequired();
    req.authUser = await this.tokens.verifyAccess(token);
    return true;
  }
}

/** @RequireOrigin 이 붙은 핸들러에서 Origin 헤더를 허용 목록(WEB_ORIGIN + EXTRA_ALLOWED_ORIGINS, development 는 loopback)과 비교한다. 누락도 거부. */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_ORIGIN, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const origin = ctx.switchToHttp().getRequest<Request>().header('origin');
    if (!isAllowedOrigin(this.env, origin)) throw Errors.originRejected();
    return true;
  }
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header.trim());
  return m?.[1];
}
