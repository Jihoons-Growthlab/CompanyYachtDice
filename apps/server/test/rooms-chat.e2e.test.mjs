// 방 옵션(비공개·봇 허용)·초대·채팅·새로고침 복원·로비 갱신 E2E
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { call, cmdId, makeUser, ORIGIN, startApp, waitFor } from './helpers.mjs';

let ctx;
before(async () => {
  ctx = await startApp();
});
after(async () => {
  await ctx?.app.close();
});
const req = (method, path, token, body) => call(ctx.base, method, '/api/v1' + path, { token, body });
const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(ctx.base, { auth: { token }, extraHeaders: { origin: ORIGIN }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
const emit = (s, ev, body) => new Promise((r) => s.emit(ev, body, r));
const next = (s, ev, pred = () => true, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${ev}`)), ms);
    const h = (p) => {
      if (!pred(p)) return;
      clearTimeout(t);
      s.off(ev, h);
      resolve(p);
    };
    s.on(ev, h);
  });

describe('방 옵션', () => {
  test('비공개 방: 코드 없이·틀린 코드로 입장 불가, 맞는 코드로 입장, 목록에 비공개·상태 표시', async () => {
    const a = await makeUser(ctx.base, 'PL');
    const b = await makeUser(ctx.base, 'B');
    const room = (await req('POST', '/rooms', a.token, { name: '비밀 평가', capacity: 3, visibility: 'PRIVATE', turnTimeLimitSec: 15 })).json.data;
    assert.equal(room.isPrivate, true);
    assert.match(room.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);
    const listed = (await req('GET', '/rooms', b.token)).json.data.items.find((r) => r.id === room.id);
    assert.deepEqual([listed.isPrivate, listed.status, listed.ownerNickname, listed.turnTimeLimitSec], [true, 'WAITING', 'PL', 15]);
    assert.equal(JSON.stringify(listed).includes(room.joinCode), false, '목록에 코드 노출 안 함');
    assert.equal((await req('POST', `/rooms/${room.id}/join`, b.token)).json.error.code, 'JOIN_CODE_REQUIRED');
    assert.equal((await req('POST', `/rooms/${room.id}/join`, b.token, { code: 'WRONG1' })).json.error.code, 'JOIN_CODE_INVALID');
    assert.equal((await req('POST', `/rooms/${room.id}/join`, b.token, { code: room.joinCode.toLowerCase() })).status, 200);
  });

  test('봇 허용 방: 방장이 봇 추가(자동 준비)·제외, 봇 비허용 방은 거부, 진행 중 방도 목록에 표시', async () => {
    const a = await makeUser(ctx.base, 'PL');
    const room = (await req('POST', '/rooms', a.token, { name: '봇 평가', capacity: 3 })).json.data;
    const r1 = (await req('POST', `/rooms/${room.id}/bots`, a.token)).json.data;
    const bot = r1.members.find((m) => m.isBot);
    assert.ok(bot?.ready, '봇 자동 준비');
    assert.equal(r1.start.canStart, true);
    const r2 = (await req('DELETE', `/rooms/${room.id}/bots/${bot.userId}`, a.token)).json.data;
    assert.equal(r2.members.length, 1);
    await req('POST', `/rooms/${room.id}/bots`, a.token);
    await req('POST', `/rooms/${room.id}/start`, a.token);
    const listed = (await req('GET', '/rooms', a.token)).json.data.items.find((r) => r.id === room.id);
    assert.equal(listed.status, 'PLAYING');

    const noBots = (await req('POST', '/rooms', a.token, { name: '사람만', capacity: 2, botsAllowed: false })).json.data;
    // 테스트 모드에서는 허용되므로 운영 동작은 modes.e2e 에서 확인
    assert.equal(noBots.botsAllowed, false);
  });

  test('새로고침 복원: GET /rooms/current 가 참여 중인 방을 돌려준다', async () => {
    const a = await makeUser(ctx.base, 'PL');
    assert.equal((await req('GET', '/rooms/current', a.token)).json.data, null);
    const room = (await req('POST', '/rooms', a.token, { name: '복원', capacity: 2 })).json.data;
    assert.equal((await req('GET', '/rooms/current', a.token)).json.data.id, room.id);
  });
});

describe('초대', () => {
  test('검색 → 초대(실시간 알림) → 중복 초대는 같은 초대 → 수락하면 비공개 방도 코드 없이 입장', async () => {
    const a = await makeUser(ctx.base, `초대PL${Date.now() % 10000}`);
    const nick = `초대대상${Date.now() % 100000}`;
    const b = await makeUser(ctx.base, nick);
    const room = (await req('POST', '/rooms', a.token, { name: '초대 평가', capacity: 2, visibility: 'PRIVATE' })).json.data;
    const sb = await connect(b.token);
    try {
      const found = (await req('GET', `/users/search?q=${encodeURIComponent(nick.slice(0, 5))}`, a.token)).json.data.items;
      const hit = found.find((u) => u.userId === b.userId);
      assert.ok(hit);
      await waitFor(async () => (await req('GET', `/users/search?q=${encodeURIComponent(nick)}`, a.token)).json.data.items[0]?.online);

      const got = next(sb, 'invite:received');
      const inv = (await req('POST', `/rooms/${room.id}/invites`, a.token, { targetUserId: b.userId })).json.data;
      assert.equal((await got).id, inv.id);
      const dup = (await req('POST', `/rooms/${room.id}/invites`, a.token, { targetUserId: b.userId })).json.data;
      assert.equal(dup.id, inv.id, '중복 초대 → 기존 초대');
      assert.equal((await req('GET', '/me/room-invites', b.token)).json.data.items.length, 1);

      const acc = await req('POST', `/room-invites/${inv.id}/accept`, b.token);
      assert.equal(acc.status, 200);
      assert.equal(acc.json.data.invite.status, 'ACCEPTED');
      assert.ok(acc.json.data.room.members.some((m) => m.userId === b.userId));
      assert.equal((await req('POST', `/room-invites/${inv.id}/accept`, b.token)).json.error.code, 'INVITE_NOT_PENDING');
      assert.equal((await req('GET', '/me/room-invites', b.token)).json.data.items.length, 0);
    } finally {
      sb.close();
    }
  });

  test('거절·남의 초대·방장 아님·만료', async () => {
    const [a, b, c] = [await makeUser(ctx.base, 'A'), await makeUser(ctx.base, 'B'), await makeUser(ctx.base, 'C')];
    const room = (await req('POST', '/rooms', a.token, { name: '거절', capacity: 4 })).json.data;
    const inv = (await req('POST', `/rooms/${room.id}/invites`, a.token, { targetUserId: b.userId })).json.data;
    assert.equal((await req('POST', `/room-invites/${inv.id}/accept`, c.token)).json.error.code, 'INVITE_NOT_FOUND', '남의 초대');
    assert.equal((await req('POST', `/room-invites/${inv.id}/decline`, b.token)).json.data.invite.status, 'DECLINED');
    await req('POST', `/rooms/${room.id}/join`, c.token);
    assert.equal((await req('POST', `/rooms/${room.id}/invites`, c.token, { targetUserId: b.userId })).json.error.code, 'NOT_ROOM_OWNER');
    assert.equal((await req('POST', `/rooms/${room.id}/invites`, a.token, { targetUserId: c.userId })).json.error.code, 'INVITE_INVALID_TARGET', '이미 참여 중');

    const inv2 = (await req('POST', `/rooms/${room.id}/invites`, a.token, { targetUserId: b.userId })).json.data;
    const { default: pg } = await import('pg');
    const { testEnv } = await import('./helpers.mjs');
    const db = new pg.Client({ connectionString: testEnv().DATABASE_URL });
    await db.connect();
    await db.query(`UPDATE room_invites SET expires_at = now() - interval '1 second' WHERE id = $1`, [inv2.id]);
    await db.end();
    assert.equal((await req('POST', `/room-invites/${inv2.id}/accept`, b.token)).json.error.code, 'INVITE_EXPIRED');
  });
});

describe('채팅', () => {
  async function pair() {
    const a = await makeUser(ctx.base, '채팅A');
    const b = await makeUser(ctx.base, '채팅B');
    const room = (await req('POST', '/rooms', a.token, { name: '채팅방', capacity: 3 })).json.data;
    await req('POST', `/rooms/${room.id}/join`, b.token);
    return { a, b, room };
  }

  test('실시간 송수신·작성자는 서버가 지정·중복 전송 1건·시스템 메시지·최근 50개 복원', async () => {
    const { a, b, room } = await pair();
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    try {
      const sub = await emit(sb, 'room:subscribe', { roomId: room.id });
      assert.ok(sub.data.messages.some((m) => m.kind === 'SYSTEM' && m.text.includes('입장')), '입장 시스템 메시지 복원');
      await emit(sa, 'room:subscribe', { roomId: room.id });

      const recv = next(sb, 'chat:message', (m) => m.kind === 'TEXT');
      const cid = randomUUID();
      const sent = await emit(sa, 'chat:send', { roomId: room.id, clientMessageId: cid, text: '  안녕하세요\n<b>굵게</b>  ', userId: b.userId });
      assert.equal(sent.ok, true);
      assert.equal(sent.data.userId, a.userId, '클라이언트가 보낸 userId 무시');
      assert.equal(sent.data.nickname, '채팅A');
      assert.equal(sent.data.rankLabel, '사원');
      assert.equal(sent.data.text, '안녕하세요\n<b>굵게</b>', '원문 보존(렌더링은 텍스트)');
      const m = await recv;
      assert.equal(m.id, sent.data.id);

      const again = await emit(sa, 'chat:send', { roomId: room.id, clientMessageId: cid, text: '안녕하세요\n<b>굵게</b>' });
      assert.equal(again.data.id, sent.data.id, '같은 clientMessageId 는 1건');

      const readySys = next(sa, 'chat:message', (x) => x.kind === 'SYSTEM' && x.text.includes('준비를 완료'));
      await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: true });
      await readySys;

      const hist = (await req('GET', `/rooms/${room.id}/messages`, b.token)).json.data;
      const seqs = hist.items.map((x) => x.seq);
      assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y), '오름차순');
      assert.equal(new Set(seqs).size, seqs.length, 'seq 중복 없음');
      assert.equal(hist.items.filter((x) => x.id === sent.data.id).length, 1);
      const after = (await req('GET', `/rooms/${room.id}/messages?afterSeq=${sent.data.seq}`, b.token)).json.data.items;
      assert.ok(after.every((x) => x.seq > sent.data.seq));
    } finally {
      sa.close();
      sb.close();
    }
  });

  test('검증: 비참여자 차단·길이·빈 메시지·제어문자·속도 제한', async () => {
    const { a, room } = await pair();
    const c = await makeUser(ctx.base, '외부인');
    const send = (token, text) => req('POST', `/rooms/${room.id}/messages`, token, { clientMessageId: randomUUID(), text });
    assert.equal((await send(c.token, 'hi')).json.error.code, 'NOT_ROOM_MEMBER');
    assert.equal((await req('GET', `/rooms/${room.id}/messages`, c.token)).json.error.code, 'NOT_ROOM_MEMBER');
    assert.equal((await send(a.token, '   ')).status, 400);
    assert.equal((await send(a.token, '가'.repeat(301))).status, 400);
    assert.equal((await send(a.token, 'a\u0000b')).status, 400);
    assert.equal((await send(a.token, '가'.repeat(300))).status, 201, '300자 허용');
    for (let i = 0; i < 4; i++) assert.equal((await send(a.token, `m${i}`)).status, 201);
    const limited = await send(a.token, 'too fast');
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, 'RATE_LIMITED');
  });

  test('게임 시작·종료 시스템 메시지, 게임 중에도 채팅 유지', async () => {
    const { a, b, room } = await pair();
    await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: true });
    const { match } = (await req('POST', `/rooms/${room.id}/start`, a.token)).json.data;
    assert.equal((await req('POST', `/rooms/${room.id}/messages`, b.token, { clientMessageId: randomUUID(), text: '화이팅' })).status, 201);
    await req('POST', `/dev/matches/${match.id}/finish`, a.token);
    const items = await waitFor(async () => {
      const h = (await req('GET', `/rooms/${room.id}/messages`, a.token)).json.data.items;
      return h.some((m) => m.text.startsWith('평가 종료')) ? h : null;
    });
    assert.ok(items.some((m) => m.text.startsWith('평가를 시작합니다')));
    assert.ok(items.some((m) => m.text === '화이팅'));
  });
});

describe('로비 실시간 갱신', () => {
  test('방 생성·입장·시작 시 lobby:changed', async () => {
    const a = await makeUser(ctx.base, 'L');
    const s = await connect(a.token);
    try {
      const p = next(s, 'lobby:changed');
      await req('POST', '/rooms', a.token, { name: '로비 갱신', capacity: 2 });
      await p;
    } finally {
      s.close();
    }
  });
});
void cmdId;
