import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../redis/rate-limit.service.js';
import { Errors } from '../common/app-error.js';
import { AuthPolicy } from './auth.policy.js';
import { burnVerify, hashPassword, needsRehash, verifyPassword } from './password.js';
import { hashRefreshToken, REFRESH_TOKEN_PATTERN, TokenService } from './token.service.js';
import { toMe, type MeDto } from '../users/user.dto.js';

export type ClientMeta = { ip: string; userAgent?: string };
export type AuthResult = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshMaxAgeSec: number;
  user: MeDto;
};

const RL = AuthPolicy.rateLimit;

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async signup(email: string, password: string, meta: ClientMeta): Promise<AuthResult> {
    await this.rateLimit.consume(`signup:ip:${meta.ip}`, RL.signupPerIp);
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.prisma.user.create({
        data: { localCredential: { create: { email, passwordHash } } },
        include: { localCredential: true },
      });
      this.logger.log(`signup user=${user.id}`);
      return await this.issue(user.id, toMe(user), meta);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.emailTaken();
      throw err;
    }
  }

  async login(email: string, password: string, meta: ClientMeta): Promise<AuthResult> {
    await this.rateLimit.consume(`login:ip:${meta.ip}`, RL.loginPerIp);
    const emailKey = `login:fail:${email}`;
    await this.rateLimit.assertBelow(emailKey, RL.loginFailuresPerEmail);

    const cred = await this.prisma.localCredential.findUnique({ where: { email }, include: { user: true } });
    const ok = cred ? await verifyPassword(password, cred.passwordHash) : (await burnVerify(password), false);
    if (!cred || !ok) {
      await this.rateLimit.consume(emailKey, RL.loginFailuresPerEmail).catch((e) => {
        // 한도 도달 자체는 이번 응답을 바꾸지 않는다(다음 시도부터 429). 저장소 장애는 그대로 전파.
        if (e?.code !== 'RATE_LIMITED') throw e;
      });
      throw Errors.invalidCredentials();
    }
    await this.rateLimit.reset(emailKey);
    if (needsRehash(cred.passwordHash)) {
      await this.prisma.localCredential.update({
        where: { userId: cred.userId },
        data: { passwordHash: await hashPassword(password), passwordUpdatedAt: new Date() },
      });
    }
    return this.issue(cred.userId, toMe({ ...cred.user, localCredential: cred }), meta);
  }

  /**
   * Refresh 회전. 한 트랜잭션에서:
   * - 미존재 → INVALID / 폐기됨(ROTATED) → 재사용 탐지: family 전체 폐기 → REUSED
   * - 만료 → EXPIRED / 정상 → 조건부 UPDATE(revoked_at IS NULL)로 폐기 후 새 토큰 발급
   * 조건부 UPDATE 가 0건이면 동시에 같은 토큰이 사용된 것 → 재사용으로 처리.
   */
  async refresh(rawToken: string | undefined, meta: ClientMeta): Promise<AuthResult> {
    if (!rawToken) throw Errors.refreshMissing();
    if (!REFRESH_TOKEN_PATTERN.test(rawToken)) throw Errors.refreshInvalid();
    await this.rateLimit.consume(`refresh:ip:${meta.ip}`, RL.refreshPerIp);

    const now = new Date();
    const hash = hashRefreshToken(rawToken);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const s = await tx.session.findUnique({ where: { refreshTokenHash: hash } });
      if (!s) return { error: Errors.refreshInvalid() } as const;
      if (s.revokedAt) {
        if (s.revokeReason === 'ROTATED' || s.revokeReason === 'REUSE_DETECTED') {
          await this.revokeFamily(tx, s.familyId, 'REUSE_DETECTED', now);
          return { error: Errors.refreshReused(), reuse: s } as const;
        }
        return { error: s.revokeReason === 'EXPIRED' ? Errors.sessionExpired() : Errors.sessionRevoked() } as const;
      }
      if (s.expiresAt <= now || s.absoluteExpiresAt <= now) {
        await tx.session.update({ where: { id: s.id }, data: { revokedAt: now, revokeReason: 'EXPIRED' } });
        return { error: Errors.sessionExpired() } as const;
      }
      const { token, hash: newHash } = this.tokens.newRefreshToken();
      const expiresAt = this.refreshExpiry(now, s.absoluteExpiresAt);
      const next = await tx.session.create({
        data: {
          userId: s.userId,
          familyId: s.familyId,
          refreshTokenHash: newHash,
          expiresAt,
          absoluteExpiresAt: s.absoluteExpiresAt,
          userAgent: this.ua(meta),
        },
      });
      const claimed = await tx.session.updateMany({
        where: { id: s.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'ROTATED', replacedById: next.id },
      });
      if (claimed.count !== 1) {
        // 같은 토큰의 동시 회전: 이 트랜잭션은 롤백하고 바깥에서 family 를 폐기한다.
        throw new ConcurrentRefresh(s.familyId);
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: s.userId }, include: { localCredential: true } });
      return { token, expiresAt, familyId: s.familyId, user } as const;
    }).catch(async (err) => {
      if (err instanceof ConcurrentRefresh) {
        await this.revokeFamily(this.prisma, err.familyId, 'REUSE_DETECTED', now);
        return { error: Errors.refreshReused(), reuse: { familyId: err.familyId } } as const;
      }
      throw err;
    });

    if ('error' in outcome) {
      if ('reuse' in outcome && outcome.reuse) this.logger.warn(`refresh token 재사용 탐지 — family=${outcome.reuse.familyId} 전체 폐기`);
      throw outcome.error;
    }
    const access = await this.tokens.signAccess({ userId: outcome.user.id, sessionFamilyId: outcome.familyId });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: outcome.token,
      refreshMaxAgeSec: secondsUntil(outcome.expiresAt, now),
      user: toMe(outcome.user),
    };
  }

  /** 현재 기기 로그아웃: 제시된 refresh token 의 family 폐기. 토큰이 없거나 무효여도 성공(멱등). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken || !REFRESH_TOKEN_PATTERN.test(rawToken)) return;
    const s = await this.prisma.session.findUnique({ where: { refreshTokenHash: hashRefreshToken(rawToken) } });
    if (s) await this.revokeFamily(this.prisma, s.familyId, 'LOGOUT', new Date());
  }

  /** 모든 기기 로그아웃 */
  async logoutAll(userId: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'LOGOUT_ALL' },
    });
    return res.count;
  }

  /** (P3 WebSocket 등) access token 의 세션 family 가 아직 유효한지 확인 */
  async isSessionFamilyActive(familyId: string): Promise<boolean> {
    const active = await this.prisma.session.findFirst({
      where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return !!active;
  }

  /** 소셜 로그인·개발 간편 로그인 등 이미 인증된 사용자에게 세션 발급 */
  async issueSession(userId: string, meta: ClientMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { localCredential: true } });
    return this.issue(userId, toMe(user), meta);
  }

  private async issue(userId: string, user: MeDto, meta: ClientMeta): Promise<AuthResult> {
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + this.env.SESSION_ABSOLUTE_TTL_SEC * 1000);
    const expiresAt = this.refreshExpiry(now, absoluteExpiresAt);
    const familyId = randomUUID();
    const { token, hash } = this.tokens.newRefreshToken();
    await this.prisma.session.create({
      data: { userId, familyId, refreshTokenHash: hash, expiresAt, absoluteExpiresAt, userAgent: this.ua(meta) },
    });
    const access = await this.tokens.signAccess({ userId, sessionFamilyId: familyId });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: token,
      refreshMaxAgeSec: secondsUntil(expiresAt, now),
      user,
    };
  }

  private refreshExpiry(now: Date, absolute: Date): Date {
    return new Date(Math.min(now.getTime() + this.env.REFRESH_TOKEN_TTL_SEC * 1000, absolute.getTime()));
  }

  private ua(meta: ClientMeta) {
    return meta.userAgent?.slice(0, AuthPolicy.userAgentMaxLength) || null;
  }

  private async revokeFamily(
    db: Pick<PrismaService, 'session'> | Prisma.TransactionClient,
    familyId: string,
    reason: 'LOGOUT' | 'REUSE_DETECTED',
    now: Date,
  ) {
    await db.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
  }
}

class ConcurrentRefresh extends Error {
  constructor(readonly familyId: string) {
    super('concurrent refresh');
  }
}

const secondsUntil = (d: Date, now: Date) => Math.max(0, Math.floor((d.getTime() - now.getTime()) / 1000));
