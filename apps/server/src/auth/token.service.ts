import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { ENV, type Env } from '../config/env.js';
import { Errors } from '../common/app-error.js';

export type AccessClaims = { userId: string; sessionFamilyId: string };

const ALG = 'HS256';
const TYP = 'at+jwt'; // RFC 9068: access token 을 다른 JWT 와 혼동하지 않도록

/**
 * Access JWT 발급·검증. HTTP 가드와 (P3) WebSocket handshake 가 같은 verify 를 사용한다.
 * 검증: alg allowlist(HS256), typ, iss, aud, exp, sub/sid 존재.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.env.ACCESS_TOKEN_TTL_SEC;
    const token = await new SignJWT({ sid: claims.sessionFamilyId })
      .setProtectedHeader({ alg: ALG, typ: TYP })
      .setSubject(claims.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.key);
    return { token, expiresIn };
  }

  /** 실패 시 TOKEN_EXPIRED 또는 TOKEN_INVALID(AppError 401) */
  async verifyAccess(token: string): Promise<AccessClaims & { exp: number }> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALG],
        typ: TYP,
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw Errors.tokenInvalid();
      return { userId: payload.sub, sessionFamilyId: payload.sid, exp: payload.exp! };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw Errors.tokenExpired();
      throw Errors.tokenInvalid();
    }
  }

  /** Refresh token: 256bit 무작위. DB 에는 SHA-256 만 저장한다. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashRefreshToken(token) };
  }
}

export const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
