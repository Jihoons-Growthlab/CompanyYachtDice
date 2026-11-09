import { existsSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');
const ms = (def: number) => z.coerce.number().int().min(0).max(600_000).default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.url(),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'postgresql:// 형식이어야 한다'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'redis:// 또는 rediss:// 형식이어야 한다'),
  REDIS_KEY_PREFIX: z.string().default('oy:'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECT_TIMEOUT_MS: ms(3000),
  DB_STATEMENT_TIMEOUT_MS: ms(10_000),
  REDIS_CONNECT_TIMEOUT_MS: ms(3000),
  REDIS_COMMAND_TIMEOUT_MS: ms(2000),
  HEALTH_CHECK_TIMEOUT_MS: ms(1500),
  SHUTDOWN_DRAIN_MS: ms(0),
  SHUTDOWN_TIMEOUT_MS: ms(10_000),
  TRUST_PROXY: bool,

  // 인증 (P1). 정책 근거: docs/features/auth.md "보안 정책"
  JWT_ACCESS_SECRET: z.string().min(32, '32자 이상 무작위 값이어야 한다 (npm run env:init 이 생성)'),
  JWT_ISSUER: z.string().min(1).default('officeyacht-api'),
  JWT_AUDIENCE: z.string().min(1).default('officeyacht-web'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(600),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().min(300).max(90 * 86400).default(14 * 86400),
  SESSION_ABSOLUTE_TTL_SEC: z.coerce.number().int().min(300).max(180 * 86400).default(30 * 86400),
  /** 미설정 시 production=true, 그 외=false (Safari 는 http://localhost 의 Secure 쿠키를 저장하지 않음) */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  /** 쉼표 구분 추가 허용 Origin (예: Swagger 를 다른 주소에서 열 때) */
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),
  /** API 문서(/docs). 미설정 시 production=false, 그 외 true */
  API_DOCS_ENABLED: z.enum(['true', 'false']).optional(),
  /** 개발자 테스트 모드. production 에서는 값과 무관하게 비활성 */
  TEST_MODE: bool,
  /** 봇·오토 플레이 한 걸음 사이 지연(ms). 화면에서 진행이 보이도록. 테스트는 0 */
  AUTO_STEP_DELAY_MS: ms(1100),
  /** 봇·오토 플레이어 턴의 첫 동작 전 지연(ms): 다음 플레이어 전환을 눈으로 확인할 시간 */
  AUTO_TURN_START_DELAY_MS: ms(1800),
  /** 시작 안내 단계 사용 여부(기본 true). 서버 테스트 일부는 false 로 바로 시작 */
  BRIEFING_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  BRIEFING_TIMEOUT_SEC: z.coerce.number().int().min(1).max(600).default(120),

  // 소셜 로그인 (docs/social-login-setup.md). 비어 있으면 해당 공급자는 비활성.
  OAUTH_REDIRECT_BASE_URL: z.url().optional(),
  WEB_APP_URL: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  KAKAO_CLIENT_ID: z.string().default(''),
  KAKAO_CLIENT_SECRET: z.string().default(''),
  NAVER_CLIENT_ID: z.string().default(''),
  NAVER_CLIENT_SECRET: z.string().default(''),
  /** 테스트 전용: 공급자 엔드포인트를 가짜 서버로 교체. production 에서는 무시 */
  OAUTH_TEST_PROVIDER_BASE: z.url().optional(),
});

export type Env = z.infer<typeof schema> & {
  cookieSecure: boolean;
  docsEnabled: boolean;
  testMode: boolean;
  allowedOrigins: string[];
  /** development 에서만: http://localhost:* / 127.0.0.1:* Origin 허용(Vite 포트 변경 대응) */
  allowLoopbackOrigins: boolean;
  oauthRedirectBase: string;
  webAppUrl: string;
};

/**
 * 환경변수를 검증한다. 실패 시 키 이름과 사유만 출력하고(값은 출력하지 않음) 프로세스를 종료한다.
 * 로컬에서는 .env 를 읽되 이미 설정된 환경변수(EC2·컨테이너)를 덮어쓰지 않는다.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync('.env')) process.loadEnvFile('.env');
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    console.error(`[config] 환경변수 검증 실패\n${issues.join('\n')}`);
    process.exit(1);
  }
  const data = parsed.data;
  const prod = data.NODE_ENV === 'production';
  if (data.TEST_MODE && !prod && !isLocalDb(data.DATABASE_URL)) console.warn('[config] TEST_MODE 는 로컬 DB(localhost·127.0.0.1·compose postgres)에서만 켜진다 — 비활성');
  if (prod && data.TEST_MODE) console.warn('[config] production 에서는 TEST_MODE 를 무시한다(강제 비활성)');
  if (prod && data.OAUTH_TEST_PROVIDER_BASE) console.warn('[config] production 에서는 OAUTH_TEST_PROVIDER_BASE 를 무시한다');
  const webOrigin = new URL(data.WEB_ORIGIN).origin;
  const env: Env = {
    ...data,
    OAUTH_TEST_PROVIDER_BASE: prod ? undefined : data.OAUTH_TEST_PROVIDER_BASE,
    cookieSecure: data.COOKIE_SECURE ? data.COOKIE_SECURE === 'true' : prod,
    docsEnabled: data.API_DOCS_ENABLED ? data.API_DOCS_ENABLED === 'true' : !prod,
    testMode: data.TEST_MODE && !prod && isLocalDb(data.DATABASE_URL),
    allowedOrigins: [webOrigin, ...data.EXTRA_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean).map((o) => new URL(o).origin)],
    allowLoopbackOrigins: data.NODE_ENV === 'development',
    oauthRedirectBase: (data.OAUTH_REDIRECT_BASE_URL ?? webOrigin).replace(/\/$/, ''),
    webAppUrl: (data.WEB_APP_URL ?? webOrigin).replace(/\/$/, ''),
  };
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (/__PASSWORD__|__GENERATE_ME__/.test(env.DATABASE_URL + env.REDIS_URL + env.JWT_ACCESS_SECRET)) problems.push('플레이스홀더 비밀값');
    if (!env.cookieSecure) problems.push('COOKIE_SECURE=false');
    if (env.SESSION_ABSOLUTE_TTL_SEC < env.REFRESH_TOKEN_TTL_SEC) problems.push('SESSION_ABSOLUTE_TTL_SEC < REFRESH_TOKEN_TTL_SEC');
    if (problems.length) {
      console.error(`[config] production 시작 불가: ${problems.join(', ')}`);
      process.exit(1);
    }
  }
  return env;
}

export const ENV = Symbol('ENV');

/** 테스트 데이터가 원격·운영 DB 로 흘러가지 않도록 테스트 모드는 로컬 DB 에서만 허용 */
function isLocalDb(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** CSRF·소켓 Origin 검사 공용 */
export function isAllowedOrigin(env: Env, origin: string | undefined): boolean {
  if (!origin) return false;
  if (env.allowedOrigins.includes(origin)) return true;
  return env.allowLoopbackOrigins && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}
