// API 문서와 운영/개발 모드 분리 검증
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeUser, startApp, testEnv } from './helpers.mjs';

describe('API 문서(Swagger)', () => {
  test('개발: /docs UI 와 OpenAPI 3 JSON, 실제 라우트·Bearer 인증 반영', async () => {
    const { app, base } = await startApp();
    try {
      const ui = await fetch(`${base}/docs`);
      assert.equal(ui.status, 200);
      assert.match(await ui.text(), /swagger-ui/i);
      const doc = await (await fetch(`${base}/docs/json`)).json();
      assert.match(doc.openapi, /^3\./);
      for (const p of ['/api/v1/auth/signup', '/api/v1/auth/login', '/api/v1/me', '/api/v1/rooms/{id}/start', '/api/v1/matches/{id}/commands', '/api/v1/dev/rooms']) {
        assert.ok(doc.paths[p], `${p} 문서화`);
      }
      assert.equal(doc.components.securitySchemes.access.scheme, 'bearer');
      assert.equal(doc.components.securitySchemes.refresh.in, 'cookie');
      const login = doc.paths['/api/v1/auth/login'].post;
      assert.ok(login.requestBody.content['application/json'].schema.properties.email, 'zod 스키마 → 요청 본문');
      assert.ok(login.responses['401'] && login.responses['429'], '오류 코드 표시');
      assert.ok(doc.paths['/api/v1/me'].get.security.some((s) => 'access' in s));
      assert.equal(Object.keys(doc.paths).some((p) => /compan|shop|wallet/.test(p)), false, '미구현 API 없음');
    } finally {
      await app.close();
    }
  });
});

describe('운영 모드에서 개발 기능 차단', () => {
  test('production: TEST_MODE=true 여도 /dev 경로 없음, 문서 비활성, 강제 시작 불가, 일반 제한시간만', async () => {
    const { app, base, env } = await startApp({ NODE_ENV: 'production', COOKIE_SECURE: 'true', TEST_MODE: 'true' });
    try {
      assert.equal(env.testMode, false);
      assert.equal((await call(base, 'GET', '/api/v1/dev/status')).status, 404);
      assert.equal((await call(base, 'POST', '/api/v1/dev/login', { body: { slot: 1 } })).status, 404);
      assert.equal((await fetch(`${base}/docs`)).status, 404);
      assert.equal((await fetch(`${base}/docs/json`)).status, 404);
      const u = await makeUser(base, 'PL');
      const bad = await call(base, 'POST', '/api/v1/rooms', { token: u.token, body: { name: 'x', capacity: 2, turnTimeLimitSec: 5 } });
      assert.equal(bad.status, 400, '단축 제한시간(5초)은 테스트 모드 전용');
      for (const old of [10, 15, 30, 90, 360]) {
        assert.equal((await call(base, 'POST', '/api/v1/rooms', { token: u.token, body: { name: 'x', capacity: 2, turnTimeLimitSec: old } })).status, 400, `${old}초 거부`);
      }
      const def = await call(base, 'POST', '/api/v1/rooms', { token: u.token, body: { name: 'd', capacity: 2 } });
      assert.equal(def.json.data.turnTimeLimitSec, 180, '기본 3분');
      for (const sec of [60, 120, 240, 300]) {
        assert.equal((await call(base, 'POST', '/api/v1/rooms', { token: u.token, body: { name: 'm', capacity: 2, turnTimeLimitSec: sec } })).status, 201, `${sec}초 허용`);
      }
      const ok = await call(base, 'POST', '/api/v1/rooms', { token: u.token, body: { name: 'x', capacity: 2, turnTimeLimitSec: 120 } });
      assert.equal(ok.status, 201);
      assert.equal((await call(base, 'POST', `/api/v1/rooms/${ok.json.data.id}/start`, { token: u.token })).json.error.code, 'START_CONDITIONS_UNMET', '혼자 시작 불가');
      const nb = await call(base, 'POST', '/api/v1/rooms', { token: u.token, body: { name: 'nb', capacity: 3, turnTimeLimitSec: 120, botsAllowed: false } });
      assert.equal((await call(base, 'POST', `/api/v1/rooms/${nb.json.data.id}/bots`, { token: u.token })).json.error.code, 'BOTS_NOT_ALLOWED');
      const login = await call(base, 'POST', '/api/v1/auth/login', { body: { email: u.email, password: 'test-password-1234' }, origin: 'http://localhost:5999' });
      assert.equal(login.status, 403, 'production 은 loopback 임의 포트 Origin 허용 안 함');
    } finally {
      await app.close();
    }
  });

  test('TEST_MODE 는 로컬 DB 에서만 켜진다', () => {
    const remote = testEnv({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/prod', TEST_MODE: 'true' });
    assert.equal(remote.testMode, false);
    assert.equal(testEnv({ TEST_MODE: 'true' }).testMode, true);
    assert.equal(testEnv({ TEST_MODE: 'false' }).testMode, false);
  });
});
