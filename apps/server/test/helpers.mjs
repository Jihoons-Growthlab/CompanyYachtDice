import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from '../dist/app.factory.js';
import { loadEnv } from '../dist/config/env.js';

if (existsSync('.env')) process.loadEnvFile('.env');

export const ORIGIN = 'http://localhost:5173';
export const runId = randomBytes(4).toString('hex');

export function testEnv(overrides = {}) {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.pathname.endsWith('_test')) url.pathname += '_test';
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    REDIS_KEY_PREFIX: `oy:test:${runId}:`,
    WEB_ORIGIN: ORIGIN,
    TRUST_PROXY: 'true', // 테스트마다 X-Forwarded-For 로 IP 를 분리해 IP 기준 제한이 서로 간섭하지 않게 함
    LOG_LEVEL: 'error',
    TEST_MODE: 'true',
    AUTO_STEP_DELAY_MS: '0',
    AUTO_TURN_START_DELAY_MS: '0',
    BRIEFING_ENABLED: 'false', // 안내 단계 검증은 game.e2e '시작 안내 단계'에서 별도 앱으로
    ...overrides,
  });
}

export async function startApp(overrides) {
  const env = testEnv(overrides);
  const app = await createApp(env, { logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address();
  return { app, env, base: `http://127.0.0.1:${port}` };
}

let ipSeq = 1;
export const freshIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
export const uniqueEmail = (tag = 'u') => `${tag}.${runId}.${randomBytes(3).toString('hex')}@Example.COM`;

/** fetch 래퍼: JSON, Origin, IP, 쿠키 지원 */
export async function call(base, method, path, { body, token, cookie, origin = ORIGIN, ip = freshIp(), raw } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (origin) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null, setCookie: res.headers.getSetCookie() };
}

/** Set-Cookie 에서 refresh 쿠키를 "name=value" 로 추출 */
export function refreshCookie(r) {
  const c = r.setCookie.find((s) => /^(__Secure-)?oy_rt=/.test(s));
  return c ? c.split(';')[0] : undefined;
}

/** 가입 + 인사 등록까지 마친 사용자 */
export async function makeUser(base, nickname = '사원') {
  const email = uniqueEmail('g');
  const r = await call(base, 'POST', '/api/v1/auth/signup', { body: { email, password: 'test-password-1234' } });
  const token = r.json.data.accessToken;
  await call(base, 'PUT', '/api/v1/me/profile', { token, body: { nickname, departmentLabel: '기획' } });
  return { token, userId: r.json.data.user.id, email };
}

export async function waitFor(fn, { timeout = 8000, interval = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, interval));
  }
}

let cmdSeq = 0;
export const cmdId = () => `00000000-0000-4000-8000-${String(++cmdSeq).padStart(12, '0')}`.replace(/^0{8}/, runId.padEnd(8, '0'));
