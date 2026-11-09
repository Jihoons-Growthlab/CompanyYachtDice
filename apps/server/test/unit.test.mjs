import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { hashPassword, verifyPassword, needsRehash } from '../dist/auth/password.js';
import { TokenService, hashRefreshToken, REFRESH_TOKEN_PATTERN } from '../dist/auth/token.service.js';
import { readCookie } from '../dist/common/cookies.js';
import { bearer } from '../dist/auth/auth.guard.js';
import { testEnv } from './helpers.mjs';

test('password: argon2id PHC 해시·검증·재해시 판단', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(h, await hashPassword('correct horse battery'), 'salt 가 매번 달라야 한다');
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterY', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.equal(needsRehash(h), false);
  assert.equal(needsRehash(h.replace('t=2', 't=1')), true);
  // 유니코드 정규화(NFC): 조합형/완성형 한글이 같은 비밀번호로 취급
  const k = await hashPassword('한글비밀번호입니다');
  assert.equal(await verifyPassword('한글비밀번호입니다'.normalize('NFD'), k), true);
});

test('token: 발급·검증 및 변조·만료·alg 거부', async () => {
  const env = testEnv();
  const svc = new TokenService(env);
  const { token, expiresIn } = await svc.signAccess({ userId: 'u1', sessionFamilyId: 'f1' });
  assert.equal(expiresIn, env.ACCESS_TOKEN_TTL_SEC);
  const v = await svc.verifyAccess(token);
  assert.deepEqual([v.userId, v.sessionFamilyId], ['u1', 'f1']);
  assert.ok(v.exp > Date.now() / 1000);

  const code = async (t) => { try { await svc.verifyAccess(t); return 'OK'; } catch (e) { return e.code; } };
  const [h, p, s] = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'admin' })).toString('base64url');
  assert.equal(await code(`${h}.${tamperedPayload}.${s}`), 'TOKEN_INVALID');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url');
  assert.equal(await code(`${none}.${p}.`), 'TOKEN_INVALID');

  const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  const base = () => new SignJWT({ sid: 'f1' }).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setSubject('u1').setIssuedAt();
  const expired = await base().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setIssuedAt(Math.floor(Date.now() / 1000) - 120).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
  assert.equal(await code(expired), 'TOKEN_EXPIRED');
  const wrongAud = await base().setIssuer(env.JWT_ISSUER).setAudience('other').setExpirationTime('5m').sign(key);
  assert.equal(await code(wrongAud), 'TOKEN_INVALID');
  const wrongTyp = await new SignJWT({ sid: 'f1' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setIssuedAt().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime('5m').sign(key);
  assert.equal(await code(wrongTyp), 'TOKEN_INVALID');
  const otherKey = await base().setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime('5m').sign(new TextEncoder().encode('x'.repeat(40)));
  assert.equal(await code(otherKey), 'TOKEN_INVALID');
});

test('refresh token: 256bit base64url, 해시는 sha256 hex', () => {
  const svc = new TokenService(testEnv());
  const a = svc.newRefreshToken();
  assert.match(a.token, REFRESH_TOKEN_PATTERN);
  assert.equal(a.hash, hashRefreshToken(a.token));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, svc.newRefreshToken().token);
});

test('cookie·bearer 파서', () => {
  assert.equal(readCookie('a=1; oy_rt=abc%2Ddef; b=2', 'oy_rt'), 'abc-def');
  assert.equal(readCookie('xoy_rt=1', 'oy_rt'), undefined);
  assert.equal(readCookie(undefined, 'oy_rt'), undefined);
  assert.equal(bearer('Bearer a.b.c'), 'a.b.c');
  assert.equal(bearer('bearer a.b.c'), undefined);
  assert.equal(bearer('Bearer a.b'), undefined);
});
