// 소셜 로그인 E2E: 실제 공급자 대신 가짜 공급자 서버(토큰·JWKS·사용자정보)를 띄워 서버 검증 로직을 실행한다.
// 실제 Google·카카오·네이버 연동은 자격 증명이 필요해 이 테스트로 검증되지 않는다(docs/social-login-setup.md).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { call, refreshCookie, startApp } from './helpers.mjs';

const CLIENT = { google: 'google-client-id', kakao: 'kakao-rest-key', naver: 'naver-client-id' };
let fake;
let fakeBase;
let ctx;
let key;
let jwk;

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const dec = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());
const s256 = (v) => createHash('sha256').update(v).digest('base64url');

before(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  key = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  fake = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = await new Promise((r) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => r(new URLSearchParams(d)));
    });
    const json = (o, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    // code = base64url(JSON{sub, nonce?, challenge?, aud?, iss?, fail?}) — 테스트가 공급자 동작을 지정
    if (url.pathname === '/google/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/google/token') {
      const c = dec(body.get('code'));
      if (c.fail) return json({ error: 'invalid_grant' }, 400);
      if (body.get('client_secret') !== 'google-secret') return json({ error: 'invalid_client' }, 401);
      if (s256(body.get('code_verifier') ?? '') !== c.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE' }, 400);
      const idToken = await new SignJWT({ nonce: c.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setSubject(c.sub)
        .setIssuer(c.iss ?? `${fakeBase}/google`)
        .setAudience(c.aud ?? CLIENT.google)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key);
      return json({ id_token: idToken, access_token: 'x' });
    }
    if (url.pathname === '/kakao/token') {
      const c = dec(body.get('code'));
      if (s256(body.get('code_verifier') ?? '') !== c.challenge) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: `kakao.${c.sub}` });
    }
    if (url.pathname === '/kakao/userinfo') return json({ id: Number(req.headers.authorization.split('kakao.')[1]) });
    if (url.pathname === '/naver/token') {
      if (!body.get('state') || body.get('client_secret') !== 'naver-secret') return json({ error: 'invalid_request' }, 400);
      return json({ access_token: `naver.${dec(body.get('code')).sub}` });
    }
    if (url.pathname === '/naver/userinfo') return json({ resultcode: '00', message: 'success', response: { id: req.headers.authorization.split('naver.')[1] } });
    json({ error: 'not_found' }, 404);
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  ctx = await startApp({
    OAUTH_TEST_PROVIDER_BASE: fakeBase,
    GOOGLE_CLIENT_ID: CLIENT.google,
    GOOGLE_CLIENT_SECRET: 'google-secret',
    KAKAO_CLIENT_ID: CLIENT.kakao,
    NAVER_CLIENT_ID: CLIENT.naver,
    NAVER_CLIENT_SECRET: 'naver-secret',
    WEB_APP_URL: 'http://localhost:5173',
  });
});
after(async () => {
  await ctx?.app.close();
  await new Promise((r) => fake?.close(r));
});

/** /start 호출 → 공급자 인가 URL 의 파라미터와 바인딩 쿠키 */
async function start(provider) {
  const res = await fetch(`${ctx.base}/api/v1/auth/${provider}/start`, { redirect: 'manual', headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  const binding = res.headers.getSetCookie().find((c) => c.startsWith('oy_oauth='));
  return { loc, params: loc.searchParams, cookie: binding?.split(';')[0], setCookie: binding };
}
/** 공급자가 브라우저를 콜백으로 돌려보낸 상황 재현 */
async function callback(provider, query, cookie) {
  const res = await fetch(`${ctx.base}/api/v1/auth/${provider}/callback?${new URLSearchParams(query)}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  return { loc, auth: loc.searchParams.get('auth'), reason: loc.searchParams.get('reason'), isNew: loc.searchParams.get('new') === '1', refresh: refreshCookie({ setCookie: res.headers.getSetCookie() }) };
}
const meVia = async (refresh) => {
  const r = await call(ctx.base, 'POST', '/api/v1/auth/refresh', { cookie: refresh });
  return r.json.data.user;
};

describe('소셜 로그인', () => {
  test('공급자 목록: 설정된 공급자만 enabled', async () => {
    const r = await call(ctx.base, 'GET', '/api/v1/auth/providers');
    assert.deepEqual(r.json.data.map((p) => [p.id, p.enabled]), [['google', true], ['kakao', true], ['naver', true]]);
  });

  test('start: state·PKCE(S256)·nonce·redirect_uri·바인딩 쿠키', async () => {
    const { loc, params, setCookie } = await start('google');
    assert.equal(loc.origin + loc.pathname, `${fakeBase}/google/authorize`);
    assert.equal(params.get('client_id'), CLIENT.google);
    assert.equal(params.get('redirect_uri'), 'http://localhost:5173/api/v1/auth/google/callback');
    assert.equal(params.get('scope'), 'openid');
    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.match(params.get('state'), /^[A-Za-z0-9_-]{43}$/);
    assert.ok(params.get('nonce'));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const n = await start('naver');
    assert.equal(n.params.get('code_challenge'), null, '네이버는 PKCE 미지원');
  });

  test('Google(OIDC): 신규 가입 → 세션 발급 → 재로그인은 같은 계정, 이메일 없음(자동 병합 없음)', async () => {
    const sub = `g-${Date.now()}`;
    const s = await start('google');
    const code = enc({ sub, nonce: s.params.get('nonce'), challenge: s.params.get('code_challenge') });
    const r = await callback('google', { code, state: s.params.get('state') }, s.cookie);
    assert.deepEqual([r.auth, r.isNew], ['success', true]);
    assert.equal(r.loc.origin, 'http://localhost:5173');
    assert.equal(r.loc.href.includes('token'), false, 'URL 에 토큰 없음');
    const u1 = await meVia(r.refresh);
    assert.equal(u1.email, null);
    assert.equal(u1.profileCompleted, false, '최초 로그인 → 인사 등록 필요');

    const s2 = await start('google');
    const r2 = await callback('google', { code: enc({ sub, nonce: s2.params.get('nonce'), challenge: s2.params.get('code_challenge') }), state: s2.params.get('state') }, s2.cookie);
    assert.deepEqual([r2.auth, r2.isNew], ['success', false]);
    assert.equal((await meVia(r2.refresh)).id, u1.id);
  });

  test('카카오·네이버: 사용자 정보의 id 로 계정 매핑', async () => {
    for (const p of ['kakao', 'naver']) {
      const sub = String(Date.now() + (p === 'kakao' ? 1 : 2));
      const s = await start(p);
      const r = await callback(p, { code: enc({ sub, challenge: s.params.get('code_challenge') }), state: s.params.get('state') }, s.cookie);
      assert.equal(r.auth, 'success', `${p}: ${r.reason}`);
      assert.ok((await meVia(r.refresh)).id);
    }
  });

  test('같은 subject 라도 공급자가 다르면 다른 계정', async () => {
    const sub = String(Date.now());
    const ids = [];
    for (const p of ['kakao', 'naver']) {
      const s = await start(p);
      const r = await callback(p, { code: enc({ sub, challenge: s.params.get('code_challenge') }), state: s.params.get('state') }, s.cookie);
      ids.push((await meVia(r.refresh)).id);
    }
    assert.notEqual(ids[0], ids[1]);
  });

  test('사용자 취소 → CANCELLED, 공급자 오류 → PROVIDER_ERROR', async () => {
    const s = await start('kakao');
    const r = await callback('kakao', { error: 'access_denied', error_description: 'User denied access', state: s.params.get('state') }, s.cookie);
    assert.deepEqual([r.auth, r.reason, r.refresh], ['error', 'CANCELLED', undefined]);
    const s2 = await start('google');
    const r2 = await callback('google', { error: 'server_error', state: s2.params.get('state') }, s2.cookie);
    assert.equal(r2.reason, 'PROVIDER_ERROR');
    const s3 = await start('google');
    const r3 = await callback('google', { code: enc({ fail: true }), state: s3.params.get('state') }, s3.cookie);
    assert.equal(r3.reason, 'PROVIDER_ERROR', '토큰 교환 실패');
  });

  test('state 검증: 재사용·위조·다른 브라우저(쿠키 불일치)·공급자 불일치 → STATE_INVALID', async () => {
    const s = await start('google');
    const ok = { code: enc({ sub: 'x1', nonce: s.params.get('nonce'), challenge: s.params.get('code_challenge') }), state: s.params.get('state') };
    assert.equal((await callback('google', ok, 'oy_oauth=someone-else')).reason, 'STATE_INVALID', '바인딩 쿠키 불일치');
    assert.equal((await callback('google', ok, s.cookie)).reason, 'STATE_INVALID', '실패한 시도로 이미 소비된 state 재사용');
    assert.equal((await callback('google', { code: 'x', state: 'A'.repeat(43) }, s.cookie)).reason, 'STATE_INVALID', '위조 state');
    const k = await start('kakao');
    assert.equal((await callback('naver', { code: 'x', state: k.params.get('state') }, k.cookie)).reason, 'STATE_INVALID', '공급자 불일치');
  });

  test('ID 토큰 검증: nonce·aud·iss 불일치 → PROVIDER_ERROR, PKCE verifier 불일치 → PROVIDER_ERROR', async () => {
    for (const bad of [{ nonce: 'wrong' }, { aud: 'other-client' }, { iss: 'https://evil.example' }, { challenge: 'wrong' }]) {
      const s = await start('google');
      const code = enc({ sub: 'y', nonce: s.params.get('nonce'), challenge: s.params.get('code_challenge'), ...bad });
      const r = await callback('google', { code, state: s.params.get('state') }, s.cookie);
      assert.equal(r.reason, 'PROVIDER_ERROR', JSON.stringify(bad));
    }
  });

  test('지원하지 않는 공급자 → UNSUPPORTED_PROVIDER', async () => {
    const res = await fetch(`${ctx.base}/api/v1/auth/facebook/start`, { redirect: 'manual' });
    assert.equal(new URL(res.headers.get('location')).searchParams.get('reason'), 'UNSUPPORTED_PROVIDER');
  });
});

describe('자격 증명 미설정', () => {
  test('Client ID 가 없으면 enabled=false, start 는 NOT_CONFIGURED 로 웹 복귀', async () => {
    const bare = await startApp({ GOOGLE_CLIENT_ID: '', KAKAO_CLIENT_ID: '', NAVER_CLIENT_ID: '' });
    try {
      const list = await call(bare.base, 'GET', '/api/v1/auth/providers');
      assert.ok(list.json.data.every((p) => !p.enabled));
      const res = await fetch(`${bare.base}/api/v1/auth/google/start`, { redirect: 'manual' });
      assert.equal(new URL(res.headers.get('location')).searchParams.get('reason'), 'NOT_CONFIGURED');
    } finally {
      await bare.app.close();
    }
  });
});
