// 인증 E2E: 실제 PG(테스트 DB)·Redis(실행별 prefix)를 사용한다. 선행: npm run test:prepare (npm test 가 자동 실행)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { call, freshIp, refreshCookie, startApp, testEnv, uniqueEmail } from './helpers.mjs';

const PW = 'test-password-1234';
let ctx;
let db;

before(async () => {
  ctx = await startApp();
  db = new pg.Client({ connectionString: testEnv().DATABASE_URL });
  await db.connect();
});
after(async () => {
  await db?.end();
  await ctx?.app.close();
});

const signup = (email = uniqueEmail(), password = PW, opts = {}) =>
  call(ctx.base, 'POST', '/api/v1/auth/signup', { body: { email, password }, ...opts });
const login = (email, password = PW, opts = {}) => call(ctx.base, 'POST', '/api/v1/auth/login', { body: { email, password }, ...opts });
const refresh = (cookie, opts = {}) => call(ctx.base, 'POST', '/api/v1/auth/refresh', { cookie, ...opts });
const me = (token) => call(ctx.base, 'GET', '/api/v1/me', { token });

describe('공개 경로·오류 형식', () => {
  test('health 는 인증 없이 200, 접두사 없음', async () => {
    assert.equal((await call(ctx.base, 'GET', '/health/live')).status, 200);
    assert.equal((await call(ctx.base, 'GET', '/health/ready')).status, 200);
  });
  test('없는 경로·잘못된 JSON 도 통일된 오류 형식', async () => {
    const nf = await call(ctx.base, 'GET', '/api/v1/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.json.error.code, 'NOT_FOUND');
    assert.ok(nf.json.error.requestId);
    const res = await fetch(ctx.base + '/api/v1/auth/login', {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': freshIp() }, body: '{bad',
    });
    const j = await res.json();
    assert.equal(res.status, 400);
    assert.equal(j.error.code, 'MALFORMED_REQUEST');
    assert.equal(JSON.stringify(j).includes('position'), false, '파서 원문 메시지 비노출');
    assert.ok(j.error.requestId);
    const big = await call(ctx.base, 'POST', '/api/v1/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(20_000) } });
    assert.equal(big.status, 413);
    assert.equal(big.json.error.code, 'PAYLOAD_TOO_LARGE');
  });
});

describe('회원가입', () => {
  test('201 + access token 본문, refresh 는 HttpOnly 쿠키로만', async () => {
    const email = uniqueEmail('signup');
    const r = await signup(email);
    assert.equal(r.status, 201);
    const d = r.json.data;
    assert.equal(d.tokenType, 'Bearer');
    assert.ok(d.accessToken.split('.').length === 3);
    assert.equal(d.user.email, email.toLowerCase(), '이메일 소문자 정규화');
    assert.equal(d.user.profileCompleted, false);
    assert.equal(JSON.stringify(r.json).includes('refresh'), false, '본문에 refresh token 없음');
    const sc = r.setCookie.join('\n');
    assert.match(sc, /oy_rt=[A-Za-z0-9_-]{43};/);
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    assert.match(sc, /Path=\/api\/v1\/auth/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
  test('비밀번호는 argon2id 해시로만 저장', async () => {
    const email = uniqueEmail('hash');
    await signup(email);
    const row = (await db.query('SELECT password_hash FROM local_credentials WHERE email=$1', [email.toLowerCase()])).rows[0];
    assert.match(row.password_hash, /^\$argon2id\$/);
    assert.equal(row.password_hash.includes(PW), false);
  });
  test('중복 이메일(대소문자 무관) 409 EMAIL_TAKEN', async () => {
    const email = uniqueEmail('dup');
    await signup(email);
    const r = await signup(email.toUpperCase());
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'EMAIL_TAKEN');
  });
  test('검증 실패 400 + 필드별 사유', async () => {
    const r = await signup('not-an-email', 'short');
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'VALIDATION_FAILED');
    const fields = r.json.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['email', 'password']);
  });
  test('Origin 누락·불일치 403 ORIGIN_REJECTED', async () => {
    assert.equal((await signup(uniqueEmail(), PW, { origin: null })).json.error.code, 'ORIGIN_REJECTED');
    assert.equal((await signup(uniqueEmail(), PW, { origin: 'https://evil.example' })).status, 403);
  });
});

describe('로그인·사용자 정보', () => {
  test('로그인 성공 → /me, 프로필 등록', async () => {
    const email = uniqueEmail('login');
    await signup(email);
    const r = await login(email.toUpperCase());
    assert.equal(r.status, 200);
    const token = r.json.data.accessToken;
    const m = await me(token);
    assert.equal(m.status, 200);
    assert.equal(m.json.data.email, email.toLowerCase());

    const bad = await call(ctx.base, 'PUT', '/api/v1/me/profile', { token, body: { nickname: ' ', departmentLabel: 'x'.repeat(31) } });
    assert.equal(bad.status, 400);
    const p = await call(ctx.base, 'PUT', '/api/v1/me/profile', { token, body: { nickname: '  김사원 ', departmentLabel: '기획' } });
    assert.equal(p.status, 200);
    assert.equal(p.json.data.nickname, '김사원');
    assert.equal(p.json.data.profileCompleted, true);
  });
  test('틀린 비밀번호·없는 계정 모두 401 INVALID_CREDENTIALS (계정 존재 비노출)', async () => {
    const email = uniqueEmail('wrong');
    await signup(email);
    const a = await login(email, 'wrong-password-xx');
    const b = await login(uniqueEmail('ghost'));
    assert.equal(a.status, 401);
    assert.equal(a.json.error.code, 'INVALID_CREDENTIALS');
    assert.deepEqual([b.status, b.json.error.code, b.json.error.message], [401, a.json.error.code, a.json.error.message]);
  });
  test('보호 경로: 토큰 없음·형식 오류·위조', async () => {
    const none = await me();
    assert.equal(none.status, 401);
    assert.equal(none.json.error.code, 'AUTH_REQUIRED');
    assert.match(none.headers.get('www-authenticate'), /^Bearer/);
    assert.equal((await me('abc')).json.error.code, 'AUTH_REQUIRED');
    assert.equal((await me('a.b.c')).json.error.code, 'TOKEN_INVALID');
  });
  test('이메일별 로그인 실패 5회 후 429 (올바른 비밀번호도 차단, Retry-After)', async () => {
    const email = uniqueEmail('brute');
    await signup(email);
    for (let i = 0; i < 5; i++) assert.equal((await login(email, `nope-${i}-xxxxxx`)).status, 401);
    const r = await login(email);
    assert.equal(r.status, 429);
    assert.equal(r.json.error.code, 'RATE_LIMITED');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  });
  test('로그인 성공 시 실패 카운터 초기화', async () => {
    const email = uniqueEmail('reset');
    await signup(email);
    for (let i = 0; i < 4; i++) await login(email, `nope-${i}-xxxxxx`);
    assert.equal((await login(email)).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await login(email, `nope-${i}-xxxxxx`)).status, 401);
  });
  test('IP 기준 가입 제한 10회/시간', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) assert.equal((await signup(uniqueEmail('ip'), PW, { ip })).status, 201);
    assert.equal((await signup(uniqueEmail('ip'), PW, { ip })).status, 429);
  });
});

describe('refresh 회전·폐기', () => {
  test('회전: 새 쿠키 발급, 이전 토큰 재사용 시 family 전체 폐기', async () => {
    const s = await signup();
    const c1 = refreshCookie(s);
    const r1 = await refresh(c1);
    assert.equal(r1.status, 200);
    const c2 = refreshCookie(r1);
    assert.ok(c2 && c2 !== c1);
    assert.equal((await me(r1.json.data.accessToken)).status, 200);

    const reuse = await refresh(c1);
    assert.equal(reuse.status, 401);
    assert.equal(reuse.json.error.code, 'REFRESH_TOKEN_REUSED');
    assert.match(reuse.setCookie.join(), /oy_rt=;/, '실패 시 쿠키 삭제');
    const after = await refresh(c2);
    assert.equal(after.status, 401, '정상 사용자 토큰도 폐기됨');
    assert.equal(after.json.error.code, 'REFRESH_TOKEN_REUSED');
  });
  test('같은 토큰 동시 refresh: 하나만 성공하거나 둘 다 실패, 이후 family 폐기', async () => {
    const c = refreshCookie(await signup());
    const results = await Promise.all([refresh(c), refresh(c)]);
    const ok = results.filter((r) => r.status === 200);
    assert.ok(ok.length <= 1, `성공 ${ok.length}건`);
    assert.ok(results.some((r) => r.json?.error?.code === 'REFRESH_TOKEN_REUSED'));
    for (const r of ok) assert.equal((await refresh(refreshCookie(r))).status, 401);
  });
  test('쿠키 없음·형식 오류·미존재', async () => {
    assert.equal((await refresh()).json.error.code, 'REFRESH_TOKEN_MISSING');
    assert.equal((await refresh('oy_rt=short')).json.error.code, 'REFRESH_TOKEN_INVALID');
    assert.equal((await refresh(`oy_rt=${'A'.repeat(43)}`)).json.error.code, 'REFRESH_TOKEN_INVALID');
    assert.equal((await refresh(refreshCookie(await signup()), { origin: null })).status, 403);
  });
  test('세션 만료 → 401 SESSION_EXPIRED', async () => {
    const s = await signup();
    await db.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [s.json.data.user.id]);
    const r = await refresh(refreshCookie(s));
    assert.equal(r.json.error.code, 'SESSION_EXPIRED');
  });
  test('절대 만료는 회전으로 연장되지 않는다', async () => {
    const s = await signup();
    const r = await refresh(refreshCookie(s));
    const rows = (await db.query('SELECT absolute_expires_at FROM sessions WHERE user_id=$1', [s.json.data.user.id])).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].absolute_expires_at.getTime(), rows[1].absolute_expires_at.getTime());
    assert.equal(r.status, 200);
  });
  test('로그아웃: 이후 refresh 401 SESSION_REVOKED, 쿠키 삭제, 멱등', async () => {
    const c = refreshCookie(await signup());
    const out = await call(ctx.base, 'POST', '/api/v1/auth/logout', { cookie: c });
    assert.equal(out.status, 204);
    assert.match(out.setCookie.join(), /oy_rt=;/);
    assert.equal((await refresh(c)).json.error.code, 'SESSION_REVOKED');
    assert.equal((await call(ctx.base, 'POST', '/api/v1/auth/logout')).status, 204);
  });
  test('모든 기기 로그아웃', async () => {
    const email = uniqueEmail('all');
    const a = await signup(email);
    const b = await login(email);
    const r = await call(ctx.base, 'POST', '/api/v1/auth/logout-all', { token: b.json.data.accessToken });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.revokedSessions, 2);
    assert.equal((await refresh(refreshCookie(a))).status, 401);
    assert.equal((await refresh(refreshCookie(b))).status, 401);
    assert.equal((await call(ctx.base, 'POST', '/api/v1/auth/logout-all')).status, 401, 'access token 필요');
  });
});

describe('Redis 장애 시 fail closed', () => {
  test('rate limit 저장소 불가 → 로그인·가입 503 (우회 허용 안 함)', async () => {
    const broken = await startApp({ REDIS_URL: 'redis://:x@127.0.0.1:1/0', REDIS_CONNECT_TIMEOUT_MS: '300' });
    try {
      const r = await call(broken.base, 'POST', '/api/v1/auth/signup', { body: { email: uniqueEmail('r'), password: PW } });
      assert.equal(r.status, 503);
      assert.equal(r.json.error.code, 'SERVICE_UNAVAILABLE');
      const l = await call(broken.base, 'POST', '/api/v1/auth/login', { body: { email: uniqueEmail('r'), password: PW } });
      assert.equal(l.status, 503);
    } finally {
      await broken.app.close();
    }
  });
});
