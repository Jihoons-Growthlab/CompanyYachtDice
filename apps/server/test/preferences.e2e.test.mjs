// 개인 환경 설정 API: 기본값·부분 저장·검증·계정 분리
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeUser, startApp } from './helpers.mjs';

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx?.app.close(); });
const req = (m, p, token, body) => call(ctx.base, m, '/api/v1' + p, { token, body });

test('저장 전 기본값(saved=false) → 부분 저장 → 다시 조회', async () => {
  const a = await makeUser(ctx.base, 'P');
  const d = (await req('GET', '/me/preferences', a.token)).json.data;
  assert.deepEqual([d.uiMode, d.uiScale, d.effectSpeed, d.soundVolume, d.saved, d.updatedAt], ['EXCEL', 'NORMAL', 'NORMAL', 60, false, null]);
  const p1 = (await req('PATCH', '/me/preferences', a.token, { uiMode: 'CMD', soundVolume: 25 })).json.data;
  assert.deepEqual([p1.uiMode, p1.soundVolume, p1.uiScale, p1.saved], ['CMD', 25, 'NORMAL', true]);
  const p2 = (await req('PATCH', '/me/preferences', a.token, { ribbonCollapsed: true })).json.data;
  assert.deepEqual([p2.uiMode, p2.ribbonCollapsed], ['CMD', true], '다른 항목 유지');
  assert.equal((await req('GET', '/me/preferences', a.token)).json.data.uiMode, 'CMD');
});

test('검증: 허용 범위·알 수 없는 키·빈 요청 → 400', async () => {
  const a = await makeUser(ctx.base, 'V');
  for (const body of [{ uiMode: 'DARK' }, { soundVolume: 101 }, { soundVolume: -1 }, { soundVolume: 1.5 }, { effectSpeed: 'TURBO' }, { reducedMotion: 'yes' }, { userId: 'x', uiMode: 'CMD' }, {}]) {
    const r = await req('PATCH', '/me/preferences', a.token, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, 'VALIDATION_FAILED');
  }
});

test('계정별 분리 · 인증 필요', async () => {
  const a = await makeUser(ctx.base, 'A');
  const b = await makeUser(ctx.base, 'B');
  await req('PATCH', '/me/preferences', a.token, { uiMode: 'CMD' });
  assert.equal((await req('GET', '/me/preferences', b.token)).json.data.uiMode, 'EXCEL');
  assert.equal((await req('GET', '/me/preferences')).status, 401);
  assert.equal((await req('PATCH', '/me/preferences', undefined, { uiMode: 'CMD' })).status, 401);
});
