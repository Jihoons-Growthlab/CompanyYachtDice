// 게임방·게임·실시간·테스트 모드 E2E (실제 PG 테스트 DB + Redis)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { total } from '../../../packages/shared/scoring.mjs';
import { call, cmdId, makeUser, ORIGIN, startApp, waitFor } from './helpers.mjs';

let ctx;
before(async () => {
  ctx = await startApp();
});
after(async () => {
  await ctx?.app.close();
});

const req = (method, path, token, body) => call(ctx.base, method, '/api/v1' + path, { token, body });
const createRoom = (token, body = {}) => req('POST', '/rooms', token, { name: '평가실', capacity: 4, turnTimeLimitSec: 30, ...body });
const getMatch = async (token, id) => (await req('GET', `/matches/${id}`, token)).json.data;
const devLogin = async (slot) => (await call(ctx.base, 'POST', '/api/v1/dev/login', { body: { slot } })).json.data;

/** 현재 차례 플레이어가 굴리고 미리보기 최고점 칸을 기록(클라이언트 역할) */
async function playTurn(tokens, m) {
  const token = tokens[m.turnUserId];
  let r = await req('POST', `/matches/${m.id}/commands`, token, { commandId: cmdId(), expectedVersion: m.version, type: 'ROLL' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = r.json.data;
  const [category] = Object.entries(s.previews).sort((a, b) => b[1] - a[1])[0];
  r = await req('POST', `/matches/${m.id}/commands`, token, { commandId: cmdId(), expectedVersion: s.version, type: 'SCORE', category });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}

describe('게임방: 생성·입장·준비·시작 조건', () => {
  test('인사 등록 전에는 방을 만들 수 없다', async () => {
    const r = await call(ctx.base, 'POST', '/api/v1/auth/signup', { body: { email: `np.${Date.now()}@example.com`, password: 'test-password-1234' } });
    const c = await createRoom(r.json.data.accessToken);
    assert.equal(c.status, 403);
    assert.equal(c.json.error.code, 'PROFILE_REQUIRED');
  });

  test('입력 검증: 정원 2–6, 이름 1–40자', async () => {
    const a = await makeUser(ctx.base, 'PL');
    assert.equal((await createRoom(a.token, { capacity: 7 })).status, 400);
    assert.equal((await createRoom(a.token, { capacity: 1 })).status, 400);
    assert.equal((await createRoom(a.token, { name: ' ' })).status, 400);
    const ok = await createRoom(a.token, { capacity: 6 });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.data.capacity, 6);
  });

  test('준비 안 된 참여자가 있으면 시작 차단 → 전원 준비 후 시작 → 중복 시작은 같은 게임', async () => {
    const a = await makeUser(ctx.base, 'PL');
    const b = await makeUser(ctx.base, '참여자');
    const room = (await createRoom(a.token)).json.data;
    assert.deepEqual(room.start.blockers, ['NOT_ENOUGH_PLAYERS']);
    assert.equal((await req('POST', `/rooms/${room.id}/start`, a.token)).json.error.code, 'START_CONDITIONS_UNMET');

    const joined = (await req('POST', `/rooms/${room.id}/join`, b.token)).json.data;
    assert.equal(joined.members.length, 2);
    assert.deepEqual(joined.start, { canStart: false, blockers: ['NOT_ALL_READY'], minPlayers: 2 });
    assert.equal((await req('POST', `/rooms/${room.id}/join`, b.token)).status, 200, '재입장 멱등');

    const blocked = await req('POST', `/rooms/${room.id}/start`, a.token);
    assert.equal(blocked.status, 409);
    assert.deepEqual(blocked.json.error.details.blockers, ['NOT_ALL_READY']);
    assert.equal((await req('POST', `/rooms/${room.id}/start`, b.token)).json.error.code, 'NOT_ROOM_OWNER');

    const ready = (await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: true })).json.data;
    assert.equal(ready.start.canStart, true);
    const unready = (await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: false })).json.data;
    assert.equal(unready.start.canStart, false, '준비 취소');
    await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: true });

    const [s1, s2] = await Promise.all([req('POST', `/rooms/${room.id}/start`, a.token), req('POST', `/rooms/${room.id}/start`, a.token)]);
    assert.equal(s1.status, 200);
    assert.equal(s2.status, 200);
    assert.equal(s1.json.data.match.id, s2.json.data.match.id, '동시 시작 요청도 게임 1개');
    const m = s1.json.data.match;
    assert.equal(m.status, 'ACTIVE');
    assert.equal(m.turnTimeLimitSec, 30);
    assert.deepEqual(m.players.map((p) => p.userId).sort(), [a.userId, b.userId].sort());
    assert.ok([a.userId, b.userId].includes(m.turnUserId));
    assert.ok(Date.parse(m.turnDeadlineAt) > Date.now() + 25_000);
    assert.equal((await req('GET', `/rooms/${room.id}`, a.token)).json.data.status, 'PLAYING');

    const c = await makeUser(ctx.base, '늦은 사원');
    assert.equal((await req('POST', `/rooms/${room.id}/join`, c.token)).json.error.code, 'ROOM_NOT_WAITING');
    assert.equal((await req('GET', `/rooms/${room.id}`, c.token)).json.error.code, 'NOT_ROOM_MEMBER');
  });

  test('정원 초과 입장 차단, 정원은 현재 인원 미만으로 못 줄임, 턴 제한시간 변경', async () => {
    const a = await makeUser(ctx.base, 'PL');
    const b = await makeUser(ctx.base, 'B');
    const c = await makeUser(ctx.base, 'C');
    const room = (await createRoom(a.token, { capacity: 2 })).json.data;
    await req('POST', `/rooms/${room.id}/join`, b.token);
    assert.equal((await req('POST', `/rooms/${room.id}/join`, c.token)).json.error.code, 'ROOM_FULL');
    assert.equal((await req('PATCH', `/rooms/${room.id}`, a.token, { capacity: 3 })).json.data.capacity, 3);
    assert.equal((await req('POST', `/rooms/${room.id}/join`, c.token)).status, 200);
    assert.equal((await req('PATCH', `/rooms/${room.id}`, a.token, { capacity: 2 })).json.error.code, 'CAPACITY_BELOW_MEMBERS');
    assert.equal((await req('PATCH', `/rooms/${room.id}`, b.token, { turnTimeLimitSec: 15 })).json.error.code, 'NOT_ROOM_OWNER');
    assert.equal((await req('PATCH', `/rooms/${room.id}`, a.token, { turnTimeLimitSec: 15 })).json.data.turnTimeLimitSec, 15);
  });

  test('방장 퇴장 시 가장 먼저 들어온 참여자에게 위임, 모두 나가면 방 닫힘', async () => {
    const [a, b, c] = [await makeUser(ctx.base, 'A'), await makeUser(ctx.base, 'B'), await makeUser(ctx.base, 'C')];
    const room = (await createRoom(a.token)).json.data;
    await req('POST', `/rooms/${room.id}/join`, b.token);
    await req('POST', `/rooms/${room.id}/join`, c.token);
    await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: true });
    const afterA = (await req('POST', `/rooms/${room.id}/leave`, a.token)).json.data;
    assert.equal(afterA.ownerId, b.userId);
    assert.equal(afterA.members.find((m) => m.userId === b.userId).ready, false, '새 방장 준비 상태 초기화');
    await req('POST', `/rooms/${room.id}/leave`, b.token);
    const last = await req('POST', `/rooms/${room.id}/leave`, c.token);
    assert.equal(last.json.data, null);
    assert.equal((await req('GET', `/rooms/${room.id}`, c.token)).json.error.code, 'ROOM_NOT_FOUND');
  });
});

describe('게임: 서버 검증·중복 처리·종료', () => {
  async function started() {
    const a = await makeUser(ctx.base, 'A');
    const b = await makeUser(ctx.base, 'B');
    const room = (await createRoom(a.token)).json.data;
    await req('POST', `/rooms/${room.id}/join`, b.token);
    await req('POST', `/rooms/${room.id}/ready`, b.token, { ready: true });
    const m = (await req('POST', `/rooms/${room.id}/start`, a.token)).json.data.match;
    return { a, b, room, m, tokens: { [a.userId]: a.token, [b.userId]: b.token } };
  }

  test('차례·버전·멱등·굴림 한도 검증', async () => {
    const { m, tokens } = await started();
    const mine = tokens[m.turnUserId];
    const other = tokens[m.players.find((p) => p.userId !== m.turnUserId).userId];
    const cmd = (token, body) => req('POST', `/matches/${m.id}/commands`, token, body);

    assert.equal((await cmd(other, { commandId: cmdId(), expectedVersion: 0, type: 'ROLL' })).json.error.code, 'NOT_YOUR_TURN');
    assert.equal((await cmd(mine, { commandId: cmdId(), expectedVersion: 0, type: 'SCORE', category: 'ones' })).json.error.code, 'NO_ROLL_YET');

    const id = cmdId();
    const r1 = await cmd(mine, { commandId: id, expectedVersion: 0, type: 'ROLL' });
    assert.equal(r1.json.data.version, 1);
    assert.equal(r1.json.data.dice.length, 5);
    assert.ok(r1.json.data.dice.every((d) => d >= 1 && d <= 6));
    const retry = await cmd(mine, { commandId: id, expectedVersion: 0, type: 'ROLL' });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.data.version, 1, '같은 commandId 재전송은 다시 굴리지 않는다');
    assert.deepEqual(retry.json.data.dice, r1.json.data.dice);
    assert.equal((await cmd(mine, { commandId: id, expectedVersion: 1, type: 'HOLD', held: [true, false, false, false, false] })).json.error.code, 'IDEMPOTENCY_CONFLICT');
    const stale = await cmd(mine, { commandId: cmdId(), expectedVersion: 0, type: 'ROLL' });
    assert.equal(stale.json.error.code, 'STALE_VERSION');
    assert.equal(stale.json.error.details.currentVersion, 1);

    const held = await cmd(mine, { commandId: cmdId(), expectedVersion: 1, type: 'HOLD', held: [true, true, false, false, false] });
    const kept = held.json.data.dice.slice(0, 2);
    const r2 = await cmd(mine, { commandId: cmdId(), expectedVersion: 2, type: 'ROLL' });
    assert.deepEqual(r2.json.data.dice.slice(0, 2), kept, '보관한 주사위 유지');
    const r3 = await cmd(mine, { commandId: cmdId(), expectedVersion: 3, type: 'ROLL' });
    assert.equal(r3.json.data.rollCount, 3);
    assert.equal((await cmd(mine, { commandId: cmdId(), expectedVersion: 4, type: 'ROLL' })).json.error.code, 'ROLL_LIMIT');
    const scored = await cmd(mine, { commandId: cmdId(), expectedVersion: 4, type: 'SCORE', category: 'choice' });
    assert.equal(scored.json.data.players.find((p) => p.scores.choice !== null).scores.choice, r3.json.data.dice.reduce((x, y) => x + y));
    assert.notEqual(scored.json.data.turnUserId, m.turnUserId, '턴 이동');
    assert.equal((await req('POST', `/matches/${m.id}/commands`, mine, { commandId: cmdId(), expectedVersion: 5, type: 'ROLL' })).json.error.code, 'NOT_YOUR_TURN');
  });

  test('2인 12라운드 수동 완주 → 결과·순위가 점수표와 일치, 방은 대기 상태로 복귀', async () => {
    const { room, m: m0, tokens, a } = await started();
    let m = m0;
    for (let i = 0; i < 24; i++) m = await playTurn(tokens, m);
    assert.equal(m.status, 'FINISHED');
    assert.equal(m.turnUserId, null);
    for (const p of m.players) {
      assert.ok(Object.values(p.scores).every((v) => v !== null), '12칸 모두 기록');
      assert.equal(p.total, total(Object.fromEntries(Object.entries(p.scores))));
      assert.ok(p.rank === 1 || p.rank === 2);
    }
    const [x, y] = m.players;
    if (x.total === y.total) assert.equal(x.rank, y.rank);
    else assert.equal((x.total > y.total ? x : y).rank, 1);
    const r = (await req('GET', `/rooms/${room.id}`, a.token)).json.data;
    assert.equal(r.status, 'WAITING');
    assert.equal(r.matchId, m.id);
    assert.ok(r.members.every((mm) => mm.isOwner || !mm.ready), '다음 판을 위해 준비 해제');
    assert.equal((await req('POST', `/matches/${m.id}/commands`, a.token, { commandId: cmdId(), expectedVersion: m.version, type: 'ROLL' })).json.error.code, 'MATCH_FINISHED');
  });

  test('오토 모드 전환 시 서버가 대신 진행', async () => {
    const { m, tokens } = await started();
    const me = m.turnUserId;
    const s = (await req('POST', `/matches/${m.id}/mode`, tokens[me], { mode: 'AUTO' })).json.data;
    assert.equal(s.players.find((p) => p.userId === me).playMode, 'AUTO');
    const moved = await waitFor(async () => {
      const cur = await getMatch(tokens[me], m.id);
      return cur.turnUserId !== me ? cur : null;
    });
    assert.ok(Object.values(moved.players.find((p) => p.userId === me).scores).some((v) => v !== null), '오토가 칸을 기록');
  });
});

describe('실시간(Socket.IO)', () => {
  const connect = (token, origin = ORIGIN) =>
    new Promise((resolve, reject) => {
      const s = io(ctx.base, { auth: { token }, extraHeaders: { origin }, transports: ['websocket'], reconnection: false, forceNew: true });
      s.once('connect', () => resolve(s));
      s.once('connect_error', (e) => {
        s.close();
        reject(e);
      });
    });
  const emit = (s, ev, body) => new Promise((resolve) => s.emit(ev, body, resolve));
  const next = (s, ev, pred = () => true) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no ${ev}`)), 5000);
      const h = (p) => {
        if (pred(p)) {
          clearTimeout(t);
          s.off(ev, h);
          resolve(p);
        }
      };
      s.on(ev, h);
    });

  test('토큰 없음·잘못된 토큰·허용되지 않은 Origin 은 연결 거부', async () => {
    await assert.rejects(connect(''), (e) => e.message === 'AUTH_REQUIRED');
    await assert.rejects(connect('a.b.c'), (e) => e.message === 'TOKEN_INVALID');
    const a = await makeUser(ctx.base, 'A');
    await assert.rejects(connect(a.token, 'https://evil.example'));
  });

  test('구독 → 상대 준비 변경·시작·굴림이 모든 참여자에게 동기화, 재접속 시 현재 상태 복원', async () => {
    const a = await makeUser(ctx.base, 'A');
    const b = await makeUser(ctx.base, 'B');
    const room = (await createRoom(a.token)).json.data;
    await req('POST', `/rooms/${room.id}/join`, b.token);
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    try {
      const ack = await emit(sa, 'room:subscribe', { roomId: room.id });
      assert.equal(ack.ok, true);
      assert.equal(ack.data.room.id, room.id);
      assert.equal(ack.data.match, null);
      await emit(sb, 'room:subscribe', { roomId: room.id });

      const seen = next(sa, 'room:state', (r) => r.members.some((m) => m.userId === b.userId && m.ready));
      assert.equal((await emit(sb, 'room:ready', { roomId: room.id, ready: true })).ok, true);
      const st = await seen;
      assert.equal(st.start.canStart, true);
      assert.ok(st.members.find((m) => m.userId === b.userId).online);

      const bSeesStart = next(sb, 'match:state');
      const started = await emit(sa, 'room:start', { roomId: room.id });
      assert.equal(started.ok, true);
      const m = await bSeesStart;
      assert.equal(m.id, started.data.id);

      const turnSock = m.turnUserId === a.userId ? sa : sb;
      const otherSock = turnSock === sa ? sb : sa;
      const otherSees = next(otherSock, 'match:state', (x) => x.version === 1);
      const rolled = await emit(turnSock, 'match:roll', { matchId: m.id, commandId: cmdId(), expectedVersion: 0 });
      assert.equal(rolled.ok, true);
      assert.deepEqual((await otherSees).dice, rolled.data.dice, '모든 참여자에게 같은 주사위');
      const bad = await emit(otherSock, 'match:roll', { matchId: m.id, commandId: cmdId(), expectedVersion: 1 });
      assert.deepEqual([bad.ok, bad.error.code], [false, 'NOT_YOUR_TURN']);

      sb.close();
      const sb2 = await connect(b.token);
      const re = await emit(sb2, 'room:subscribe', { roomId: room.id });
      assert.equal(re.data.match.version, 1, '재접속 후 구독 응답으로 현재 게임 복원');
      assert.deepEqual(re.data.match.dice, rolled.data.dice);
      sb2.close();
    } finally {
      sa.close();
      sb.close();
    }
  });
});

describe('개발 테스트 모드', () => {
  test('간편 로그인: 테스트 계정 1–6, 프로필 완료 상태', async () => {
    const accts = await call(ctx.base, 'POST', '/api/v1/dev/accounts', { body: { count: 3, profiles: [{ nickname: '김PL' }] } });
    assert.equal(accts.status, 201);
    assert.equal(accts.json.data.accounts.length >= 3, true);
    const d = await devLogin(1);
    assert.equal(d.user.nickname, '김PL');
    assert.equal(d.user.kind, 'DEV');
    assert.equal(d.user.profileCompleted, true);
    assert.equal((await call(ctx.base, 'POST', '/api/v1/dev/login', { body: { slot: 7 } })).status, 400);
  });

  test('혼자 강제 시작 → 종료 시뮬레이션(엔진 규칙)', async () => {
    const d = await devLogin(1);
    const r = (await req('POST', '/dev/rooms', d.accessToken, { capacity: 2 })).json.data.room;
    assert.equal(r.isTest, true);
    assert.equal((await req('POST', `/rooms/${r.id}/start`, d.accessToken)).json.error.code, 'START_CONDITIONS_UNMET', '일반 시작은 여전히 차단');
    const s = (await req('POST', `/dev/rooms/${r.id}/force-start`, d.accessToken)).json.data;
    assert.equal(s.match.players.length, 1);
    const end = (await req('POST', `/dev/matches/${s.match.id}/finish`, d.accessToken)).json.data;
    assert.equal(end.status, 'FINISHED');
    const p = end.players[0];
    assert.equal(p.total, total(p.scores));
    assert.equal(p.rank, 1);
  });

  test('봇 추가(자동 준비) → 봇이 자기 턴을 자동 진행, 사람 턴에서 대기', async () => {
    const d = await devLogin(2);
    const { room, match } = (await req('POST', '/dev/rooms', d.accessToken, { capacity: 3, bots: 2, start: true })).json.data;
    assert.equal(room.members.filter((m) => m.isBot).length, 2);
    assert.equal(match.players.length, 3);
    const myTurn = await waitFor(async () => {
      const m = await getMatch(d.accessToken, match.id);
      return m.turnUserId === d.user.id ? m : null;
    });
    const before = myTurn.players.filter((p) => p.isBot).map((p) => Object.values(p.scores).filter((v) => v !== null).length);
    const after = await playTurn({ [d.user.id]: d.accessToken }, myTurn);
    assert.notEqual(after.turnUserId, d.user.id);
    const back = await waitFor(async () => {
      const m = await getMatch(d.accessToken, match.id);
      return m.turnUserId === d.user.id ? m : null;
    });
    const now = back.players.filter((p) => p.isBot).map((p) => Object.values(p.scores).filter((v) => v !== null).length);
    assert.ok(now.every((n, i) => n > before[i] || n === 12), `봇이 각자 기록 ${before}→${now}`);
  });

  test('다른 테스트 계정 입장(초대 우회) → 일반 시작 차단 → 전체 준비 → 일반 시작', async () => {
    const d = await devLogin(3);
    const room = (await req('POST', '/dev/rooms', d.accessToken, { capacity: 4 })).json.data.room;
    const withMember = (await req('POST', `/dev/rooms/${room.id}/members`, d.accessToken, { slot: 4, ready: false })).json.data;
    assert.equal(withMember.members.length, 2);
    assert.deepEqual(withMember.start.blockers, ['NOT_ALL_READY']);
    const all = (await req('POST', `/dev/rooms/${room.id}/ready-all`, d.accessToken)).json.data;
    assert.equal(all.start.canStart, true);
    assert.equal((await req('POST', `/rooms/${room.id}/start`, d.accessToken)).status, 200);
  });

  test('턴 제한시간(테스트 3초): 시간 초과 시 서버가 처리, 연속 2회면 자리 비움(AWAY)', { timeout: 30_000 }, async () => {
    const d = await devLogin(5);
    const room = (await req('POST', '/dev/rooms', d.accessToken, { capacity: 2, turnTimeLimitSec: 3 })).json.data.room;
    await req('POST', `/dev/rooms/${room.id}/members`, d.accessToken, { slot: 6, ready: true });
    const { match } = (await req('POST', `/rooms/${room.id}/start`, d.accessToken)).json.data;
    const first = match.turnUserId;
    const t1 = await waitFor(async () => {
      const m = await getMatch(d.accessToken, match.id);
      return m.turnUserId !== first ? m : null;
    }, { timeout: 6000 });
    const p1 = t1.players.find((p) => p.userId === first);
    assert.equal(Object.values(p1.scores).filter((v) => v !== null).length, 1, '시간 초과로 1칸 자동 기록');
    assert.equal(p1.playMode, 'MANUAL', '1회는 아직 수동');
    const away = await waitFor(async () => {
      const m = await getMatch(d.accessToken, match.id);
      return m.players.find((p) => p.userId === first).playMode === 'AWAY' ? m : null;
    }, { timeout: 12_000 });
    assert.ok(away);
    await req('POST', '/dev/reset', d.accessToken, {});
  });
});

describe('시작 안내 단계(BRIEFING)', () => {
  let b;
  before(async () => {
    b = await startApp({ BRIEFING_ENABLED: 'true', BRIEFING_TIMEOUT_SEC: '2' });
  });
  after(async () => {
    await b?.app.close();
  });
  const r = (method, path, token, body) => call(b.base, method, '/api/v1' + path, { token, body });
  async function startTwo(extra = {}) {
    const a = await makeUser(b.base, 'A');
    const c = await makeUser(b.base, 'C');
    const room = (await r('POST', '/rooms', a.token, { name: '안내', capacity: 3, turnTimeLimitSec: 120, ...extra })).json.data;
    await r('POST', `/rooms/${room.id}/join`, c.token);
    await r('POST', `/rooms/${room.id}/ready`, c.token, { ready: true });
    const m = (await r('POST', `/rooms/${room.id}/start`, a.token)).json.data.match;
    return { a, c, room, m };
  }

  test('시작 직후 안내 단계: 턴 기한 없음·명령 거부 → 전원 확인 후 첫 턴 기한 시작', async () => {
    const { a, c, m } = await startTwo();
    assert.equal(m.phase, 'BRIEFING');
    assert.equal(m.turnDeadlineAt, null, '안내 중 타이머 미진행');
    assert.ok(m.briefingDeadlineAt);
    const first = m.turnUserId === a.userId ? a : c;
    const blocked = await r('POST', `/matches/${m.id}/commands`, first.token, { commandId: cmdId(), expectedVersion: 0, type: 'ROLL' });
    assert.equal(blocked.json.error.code, 'BRIEFING_IN_PROGRESS');

    const s1 = (await r('POST', `/matches/${m.id}/briefing`, a.token)).json.data;
    assert.equal(s1.phase, 'BRIEFING', '한 명만 확인 → 계속 대기');
    assert.equal(s1.players.find((p) => p.userId === a.userId).briefed, true);
    const again = (await r('POST', `/matches/${m.id}/briefing`, a.token)).json.data;
    assert.equal(again.version, s1.version, '중복 확인은 변화 없음');
    const s2 = (await r('POST', `/matches/${m.id}/briefing`, c.token)).json.data;
    assert.equal(s2.phase, 'PLAYING');
    const left = Date.parse(s2.turnDeadlineAt) - Date.now();
    assert.ok(left > 115_000 && left <= 121_000, `첫 턴 기한 2분 (${left}ms)`);
    assert.equal((await r('POST', `/matches/${m.id}/commands`, first.token, { commandId: cmdId(), expectedVersion: s2.version, type: 'ROLL' })).status, 200);
  });

  test('봇은 자동 확인, 안내 중 퇴장한 참여자는 확인 처리(나머지를 기다리게 하지 않음)', async () => {
    const { a, c, room, m } = await startTwo();
    void room;
    await r('POST', `/matches/${m.id}/briefing`, a.token);
    await r('POST', `/rooms/${m.roomId}/leave`, c.token);
    const s = (await r('GET', `/matches/${m.id}`, a.token)).json.data;
    assert.equal(s.phase, 'PLAYING');
    assert.equal(s.players.find((p) => p.userId === c.userId).playMode, 'AWAY');

    const solo = await makeUser(b.base, 'S');
    const sr = (await r('POST', '/rooms', solo.token, { name: '봇방', capacity: 3 })).json.data;
    await r('POST', `/rooms/${sr.id}/bots`, solo.token);
    const sm = (await r('POST', `/rooms/${sr.id}/start`, solo.token)).json.data.match;
    assert.equal(sm.phase, 'BRIEFING');
    assert.ok(sm.players.filter((p) => p.isBot).every((p) => p.briefed), '봇 자동 확인');
  });

  test('응답 없는 참여자가 있어도 안내 기한(테스트 2초)이 지나면 시작', { timeout: 10_000 }, async () => {
    const { a, m } = await startTwo();
    const s = await waitFor(async () => {
      const x = (await r('GET', `/matches/${m.id}`, a.token)).json.data;
      return x.phase === 'PLAYING' ? x : null;
    }, { timeout: 6000 });
    assert.ok(s.turnDeadlineAt);
    assert.ok(s.players.every((p) => !p.briefed), '확인하지 않았지만 시작');
  });
});
