import type { Env } from '../config/env.js';

export type ProviderId = 'google' | 'kakao' | 'naver';
export const PROVIDER_IDS: ProviderId[] = ['google', 'kakao', 'naver'];
export const DB_PROVIDER = { google: 'GOOGLE', kakao: 'KAKAO', naver: 'NAVER' } as const;

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** OIDC(Google): id_token 검증 */
  oidc?: { jwksUrl: string; issuers: string[] };
  /** 비 OIDC: access token 으로 사용자 조회 */
  userInfoUrl?: string;
  scope?: string;
  pkce: boolean;
};

/**
 * 공급자 엔드포인트(공식 문서 기준, docs/social-login-setup.md). 테스트에서는 OAUTH_TEST_PROVIDER_BASE 로
 * 가짜 서버를 가리킨다(production 에서는 env 로더가 무시).
 */
export function providerConfigs(env: Env): Record<ProviderId, ProviderConfig> {
  const t = env.OAUTH_TEST_PROVIDER_BASE?.replace(/\/$/, '');
  const at = (real: string, fake: string) => (t ? `${t}${fake}` : real);
  return {
    google: {
      id: 'google',
      name: 'Google',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: at('https://accounts.google.com/o/oauth2/v2/auth', '/google/authorize'),
      tokenUrl: at('https://oauth2.googleapis.com/token', '/google/token'),
      oidc: {
        jwksUrl: at('https://www.googleapis.com/oauth2/v3/certs', '/google/jwks'),
        issuers: t ? [`${t}/google`] : ['https://accounts.google.com', 'accounts.google.com'],
      },
      scope: 'openid', // 식별자(sub)만 사용. 이메일·프로필 미요청(동의 항목 최소화)
      pkce: true,
    },
    kakao: {
      id: 'kakao',
      name: '카카오',
      clientId: env.KAKAO_CLIENT_ID,
      clientSecret: env.KAKAO_CLIENT_SECRET, // 콘솔에서 Client Secret 활성화 시에만 필요
      authorizeUrl: at('https://kauth.kakao.com/oauth/authorize', '/kakao/authorize'),
      tokenUrl: at('https://kauth.kakao.com/oauth/token', '/kakao/token'),
      userInfoUrl: at('https://kapi.kakao.com/v2/user/me', '/kakao/userinfo'),
      pkce: true,
    },
    naver: {
      id: 'naver',
      name: '네이버',
      clientId: env.NAVER_CLIENT_ID,
      clientSecret: env.NAVER_CLIENT_SECRET,
      authorizeUrl: at('https://nid.naver.com/oauth2.0/authorize', '/naver/authorize'),
      tokenUrl: at('https://nid.naver.com/oauth2.0/token', '/naver/token'),
      userInfoUrl: at('https://openapi.naver.com/v1/nid/me', '/naver/userinfo'),
      pkce: false, // 네이버 로그인은 PKCE 미지원 → state 바인딩으로 보호
    },
  };
}

export const isConfigured = (p: ProviderConfig) => !!p.clientId && (p.id === 'kakao' || !!p.clientSecret);
