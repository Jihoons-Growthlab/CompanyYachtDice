import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Prisma } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { RateLimitService } from '../redis/rate-limit.service.js';
import { errorSummary } from '../common/util.js';
import { AuthService, type AuthResult, type ClientMeta } from '../auth/auth.service.js';
import { DB_PROVIDER, isConfigured, PROVIDER_IDS, providerConfigs, type ProviderConfig, type ProviderId } from './oauth.providers.js';

/** 웹으로 돌려보낼 때 쓰는 오류 코드(쿼리 ?auth=error&reason=…) */
export type OAuthFailure = 'UNSUPPORTED_PROVIDER' | 'NOT_CONFIGURED' | 'CANCELLED' | 'STATE_INVALID' | 'PROVIDER_ERROR' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE';
export class OAuthError extends Error {
  constructor(readonly reason: OAuthFailure, detail?: string) {
    super(detail ?? reason);
  }
}

type StateRecord = { provider: ProviderId; verifier?: string; nonce?: string; binding: string; createdAt: number };
const STATE_TTL_SEC = 600;
const HTTP_TIMEOUT_MS = 5000;
const b64url = (n: number) => randomBytes(n).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

@Injectable()
export class OAuthService {
  private readonly logger = new Logger('OAuth');
  private readonly providers: Record<ProviderId, ProviderConfig>;
  private readonly jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
    private readonly auth: AuthService,
  ) {
    this.providers = providerConfigs(env);
  }

  list() {
    return PROVIDER_IDS.map((id) => ({ id, name: this.providers[id].name, enabled: isConfigured(this.providers[id]) }));
  }

  redirectUri(id: ProviderId) {
    return `${this.env.oauthRedirectBase}/api/v1/auth/${id}/callback`;
  }

  /** 인가 URL + 브라우저 바인딩 토큰(HttpOnly 쿠키로 저장). state 는 Redis 에 1회용으로 보관. */
  async start(provider: string, meta: ClientMeta): Promise<{ url: string; binding: string }> {
    const p = this.provider(provider);
    await this.rateLimit.consume(`oauth:start:ip:${meta.ip}`, { limit: 30, windowSec: 600 }).catch((e) => {
      throw new OAuthError(e?.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE');
    });
    const state = b64url(32);
    const binding = b64url(32);
    const rec: StateRecord = { provider: p.id, binding: sha256(binding), createdAt: Date.now() };
    const params = new URLSearchParams({ response_type: 'code', client_id: p.clientId, redirect_uri: this.redirectUri(p.id), state });
    if (p.scope) params.set('scope', p.scope);
    if (p.pkce) {
      rec.verifier = b64url(48);
      params.set('code_challenge', sha256(rec.verifier));
      params.set('code_challenge_method', 'S256');
    }
    if (p.oidc) {
      rec.nonce = b64url(24);
      params.set('nonce', rec.nonce);
    }
    try {
      await this.redis.client.set(`oauth:state:${state}`, JSON.stringify(rec), 'EX', STATE_TTL_SEC);
    } catch {
      throw new OAuthError('SERVICE_UNAVAILABLE');
    }
    return { url: `${p.authorizeUrl}?${params}`, binding };
  }

  /**
   * 콜백 처리: state 1회 소비(GETDEL) → 공급자·브라우저 바인딩 검증 → (취소/오류 처리) → code 교환 → 식별자 확인
   * → provider+subject 로 계정 조회/생성(이메일 병합 없음) → 세션 발급.
   */
  async callback(provider: string, q: Record<string, unknown>, bindingCookie: string | undefined, meta: ClientMeta): Promise<{ result: AuthResult; isNew: boolean }> {
    const p = this.provider(provider);
    const state = typeof q.state === 'string' ? q.state : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new OAuthError('STATE_INVALID', 'missing state');
    let raw: string | null;
    try {
      raw = await this.redis.client.getdel(`oauth:state:${state}`);
    } catch {
      throw new OAuthError('SERVICE_UNAVAILABLE');
    }
    if (!raw) throw new OAuthError('STATE_INVALID', 'unknown or reused state');
    const rec = JSON.parse(raw) as StateRecord;
    if (rec.provider !== p.id) throw new OAuthError('STATE_INVALID', 'provider mismatch');
    if (!bindingCookie || sha256(bindingCookie) !== rec.binding) throw new OAuthError('STATE_INVALID', 'browser binding mismatch');

    if (typeof q.error === 'string') {
      // 사용자 취소: Google/카카오/네이버 모두 access_denied 계열
      throw new OAuthError(/access_denied|cancel/i.test(q.error) ? 'CANCELLED' : 'PROVIDER_ERROR', `provider error ${q.error}`);
    }
    const code = typeof q.code === 'string' ? q.code : '';
    if (!code) throw new OAuthError('PROVIDER_ERROR', 'missing code');

    const subject = await this.identify(p, code, state, rec);
    const { userId, isNew } = await this.findOrCreate(p.id, subject);
    this.logger.log(`${p.id} login user=${userId}${isNew ? ' (new)' : ''}`);
    return { result: await this.auth.issueSession(userId, meta), isNew };
  }

  private provider(id: string): ProviderConfig {
    if (!PROVIDER_IDS.includes(id as ProviderId)) throw new OAuthError('UNSUPPORTED_PROVIDER');
    const p = this.providers[id as ProviderId];
    if (!isConfigured(p)) throw new OAuthError('NOT_CONFIGURED');
    return p;
  }

  private async identify(p: ProviderConfig, code: string, state: string, rec: StateRecord): Promise<string> {
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: p.clientId, redirect_uri: this.redirectUri(p.id), code });
    if (p.clientSecret) form.set('client_secret', p.clientSecret);
    if (rec.verifier) form.set('code_verifier', rec.verifier);
    if (p.id === 'naver') form.set('state', state);
    const token = await this.http(p, p.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    if (typeof token.error === 'string') throw new OAuthError('PROVIDER_ERROR', `token error ${token.error}`);

    if (p.oidc) {
      if (typeof token.id_token !== 'string') throw new OAuthError('PROVIDER_ERROR', 'no id_token');
      try {
        const jwks = this.jwks.get(p.oidc.jwksUrl) ?? createRemoteJWKSet(new URL(p.oidc.jwksUrl), { timeoutDuration: HTTP_TIMEOUT_MS });
        this.jwks.set(p.oidc.jwksUrl, jwks);
        const { payload } = await jwtVerify(token.id_token, jwks, {
          issuer: p.oidc.issuers,
          audience: p.clientId,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'exp', 'iat'],
        });
        if (payload.nonce !== rec.nonce) throw new Error('nonce mismatch');
        return String(payload.sub);
      } catch (err) {
        throw new OAuthError('PROVIDER_ERROR', `id_token invalid: ${errorSummary(err)}`);
      }
    }

    if (typeof token.access_token !== 'string') throw new OAuthError('PROVIDER_ERROR', 'no access_token');
    const info = await this.http(p, p.userInfoUrl!, { headers: { authorization: `Bearer ${token.access_token}` } });
    const id = p.id === 'naver' ? (info.resultcode === '00' ? (info.response as { id?: unknown })?.id : undefined) : info.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length === 0 || String(id).length > 255) {
      throw new OAuthError('PROVIDER_ERROR', 'no subject in user info');
    }
    return String(id);
  }

  private async http(p: ProviderConfig, url: string, init: RequestInit): Promise<Record<string, any>> {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      const body = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok && !body.error) body.error = `http_${res.status}`;
      return body;
    } catch (err) {
      throw new OAuthError('PROVIDER_ERROR', `${p.id} request failed: ${errorSummary(err)}`);
    }
  }

  /** provider+subject 복합 유일키로만 식별. 같은 이메일이어도 다른 계정과 병합하지 않는다. */
  private async findOrCreate(provider: ProviderId, subject: string): Promise<{ userId: string; isNew: boolean }> {
    const key = { provider: DB_PROVIDER[provider], subject };
    const found = await this.prisma.externalIdentity.findUnique({ where: { provider_subject: key } });
    if (found) return { userId: found.userId, isNew: false };
    try {
      const user = await this.prisma.user.create({ data: { externalIdentities: { create: key } } });
      return { userId: user.id, isNew: true };
    } catch (err) {
      // 동시 첫 로그인 경쟁: 다른 요청이 먼저 만들었으면 그 계정 사용
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.externalIdentity.findUniqueOrThrow({ where: { provider_subject: key } });
        return { userId: again.userId, isNew: false };
      }
      throw err;
    }
  }
}
