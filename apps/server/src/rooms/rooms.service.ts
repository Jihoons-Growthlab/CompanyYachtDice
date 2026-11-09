import { randomInt } from 'node:crypto';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Errors } from '../common/app-error.js';
import type { Ref } from '../common/util.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RoomPolicy, rankLabel } from '../game/game.policy.js';
import { MatchesService } from '../matches/matches.service.js';
import { ChatService } from '../chat/chat.service.js';
import type { RoomSnapshot } from './room.dto.js';

type Tx = Prisma.TransactionClient;
const uuid = z.uuid();

@Injectable()
export class RoomsService {
  private readonly logger = new Logger('Rooms');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(forwardRef(() => MatchesService)) private readonly matches: Ref<MatchesService>,
    private readonly chat: ChatService,
  ) {}

  // ───────── 조회 ─────────

  async list() {
    const rooms = await this.prisma.room.findMany({
      where: { status: { in: ['WAITING', 'PLAYING'] }, ...(this.env.testMode ? {} : { isTest: false }) },
      orderBy: { createdAt: 'desc' },
      take: RoomPolicy.listLimit,
      include: { owner: { select: { nickname: true } }, _count: { select: { members: true } } },
    });
    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      count: r._count.members,
      turnTimeLimitSec: r.turnTimeLimitSec,
      ownerNickname: r.owner.nickname,
      isTest: r.isTest,
      status: r.status as 'WAITING' | 'PLAYING',
      isPrivate: r.isPrivate,
      botsAllowed: r.botsAllowed,
    }));
  }

  async get(roomId: string, userId: string): Promise<RoomSnapshot> {
    const snap = await this.snapshot(this.prisma, roomId);
    if (!snap.members.some((m) => m.userId === userId)) throw Errors.notRoomMember();
    return snap;
  }

  /** 방 스냅샷(직급·접속 상태·시작 가능 여부 포함) */
  async snapshot(db: Tx | PrismaService, roomId: string): Promise<RoomSnapshot> {
    if (!uuid.safeParse(roomId).success) throw Errors.roomNotFound();
    const room = await db.room.findUnique({
      where: { id: roomId },
      include: {
        members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: { nickname: true, departmentLabel: true, kind: true } } } },
        matches: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
      },
    });
    if (!room || room.status === 'CLOSED') throw Errors.roomNotFound();
    const ids = room.members.map((m) => m.userId);
    const finished = ids.length
      ? await db.matchPlayer.groupBy({ by: ['userId'], where: { userId: { in: ids }, match: { status: 'FINISHED' } }, _count: true })
      : [];
    const done = new Map(finished.map((f) => [f.userId, f._count]));
    const online = this.realtime.onlineUsers(roomId);
    const members = room.members.map((m) => ({
      userId: m.userId,
      nickname: m.user.nickname,
      departmentLabel: m.user.departmentLabel,
      rankLabel: rankLabel(done.get(m.userId) ?? 0, m.user.kind),
      ready: m.ready,
      isOwner: m.userId === room.ownerId,
      isBot: m.user.kind === 'BOT',
      online: m.user.kind === 'BOT' || online.has(m.userId),
      joinedAt: m.joinedAt.toISOString(),
    }));
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      capacity: room.capacity,
      turnTimeLimitSec: room.turnTimeLimitSec,
      ownerId: room.ownerId,
      isTest: room.isTest,
      isPrivate: room.isPrivate,
      joinCode: room.joinCode,
      botsAllowed: room.botsAllowed,
      matchId: room.matches[0]?.id ?? null,
      members,
      start: { ...startBlockers(room.status, room.capacity, members), minPlayers: RoomPolicy.minPlayersToStart },
    };
  }

  // ───────── 변경 (모두 방 행 잠금 아래에서 직렬화) ─────────

  async create(
    userId: string,
    input: { name: string; capacity: number; turnTimeLimitSec?: number; visibility?: 'PUBLIC' | 'PRIVATE'; botsAllowed?: boolean },
    opts: { isTest?: boolean } = {},
  ) {
    const owner = await this.requireProfile(userId);
    const limit = this.checkTurnLimit(input.turnTimeLimitSec ?? RoomPolicy.defaultTurnTimeLimitSec);
    const isPrivate = input.visibility === 'PRIVATE';
    const room = await this.prisma.room.create({
      data: {
        name: input.name,
        capacity: input.capacity,
        turnTimeLimitSec: limit,
        ownerId: userId,
        isTest: opts.isTest ?? false,
        isPrivate,
        joinCode: isPrivate ? newJoinCode() : null,
        botsAllowed: input.botsAllowed ?? true,
        members: { create: { userId, ready: false } },
      },
    });
    this.logger.log(`room created ${room.id}`);
    await this.chat.system(room.id, `${owner.nickname} 님이 평가실을 개설했습니다.`);
    this.realtime.lobbyChanged();
    return this.snapshot(this.prisma, room.id);
  }

  /** 새로고침·재접속 복원용: 참여 중인(대기·진행) 가장 최근 방 */
  async current(userId: string): Promise<RoomSnapshot | null> {
    const m = await this.prisma.roomMember.findFirst({
      where: { userId, room: { status: { in: ['WAITING', 'PLAYING'] } } },
      orderBy: { joinedAt: 'desc' },
      select: { roomId: true },
    });
    return m ? this.snapshot(this.prisma, m.roomId) : null;
  }

  /** 입장. 비공개 방은 입장 코드 또는 초대 수락(viaInvite)·서버 내부(봇·테스트) 경로로만. */
  async join(roomId: string, userId: string, opts: { ready?: boolean; code?: string; trusted?: boolean } = {}) {
    const user = await this.requireProfile(userId);
    let joined = false;
    const snap = await this.mutate(roomId, async (tx, room) => {
      const exists = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (exists) return; // 재시도 멱등
      if (room.status !== 'WAITING') throw Errors.roomNotWaiting();
      if (room.isPrivate && !opts.trusted) {
        if (!opts.code) throw Errors.joinCodeRequired();
        if (opts.code.trim().toUpperCase() !== room.joinCode) throw Errors.joinCodeInvalid();
      }
      const count = await tx.roomMember.count({ where: { roomId } });
      if (count >= room.capacity) throw Errors.roomFull();
      await tx.roomMember.create({ data: { roomId, userId, ready: opts.ready ?? false } });
      joined = true;
    });
    if (joined) await this.chat.system(roomId, `${user.nickname} 님이 입장했습니다.`);
    return snap;
  }

  /** 봇 추가(방장, 대기 중, 방 설정에서 봇 허용 시). 봇은 자동 준비·자동 진행. */
  async addBot(roomId: string, userId: string) {
    const snap = await this.get(roomId, userId);
    if (snap.ownerId !== userId) throw Errors.notRoomOwner();
    if (!snap.botsAllowed && !this.env.testMode) throw Errors.botsNotAllowed();
    const present = new Set(snap.members.map((m) => m.userId));
    const botId = (await this.ensureBots()).find((id) => !present.has(id));
    if (!botId) throw Errors.roomFull();
    return this.join(roomId, botId, { ready: true, trusted: true });
  }

  async removeBot(roomId: string, userId: string, botId: string) {
    let name: string | null = null;
    const snap = await this.mutate(roomId, async (tx, room) => {
      if (room.ownerId !== userId) throw Errors.notRoomOwner();
      if (room.status !== 'WAITING') throw Errors.roomNotWaiting();
      const m = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId: botId } }, include: { user: true } });
      if (!m || m.user.kind !== 'BOT') throw Errors.notRoomMember();
      name = m.user.nickname;
      await tx.roomMember.delete({ where: { roomId_userId: { roomId, userId: botId } } });
    });
    await this.chat.system(roomId, `${name} 이(가) 평가실에서 제외되었습니다.`);
    return snap;
  }

  /** 봇 계정 풀(고정 ID b1–b5). 운영에서도 봇 허용 방에서 사용. */
  async ensureBots(): Promise<string[]> {
    const ids: string[] = [];
    for (let n = 1; n <= RoomPolicy.maxBots; n++) {
      const id = `00000000-0000-7000-8000-0000000000b${n}`;
      await this.prisma.user.upsert({
        where: { id },
        create: { id, kind: 'BOT', nickname: `봇 사원 ${n}`, departmentLabel: '자동화팀', profileCompletedAt: new Date() },
        update: {},
      });
      ids.push(id);
    }
    return ids;
  }

  /** 대기 중 퇴장: 멤버 삭제, 방장이면 가장 오래된 사람(봇 제외)에게 위임, 사람이 없으면 방 닫기.
   *  진행 중 퇴장: 좌석 유지(결과까지), 해당 플레이어는 자리 비움(AWAY)으로 서버가 대신 진행. */
  async leave(roomId: string, userId: string) {
    let playingMatchId: string | null = null;
    let heirName: string | null = null;
    const leaver = await this.prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } });
    const snap = await this.mutate(roomId, async (tx, room) => {
      const me = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (!me) throw Errors.notRoomMember();
      if (room.status === 'PLAYING') {
        playingMatchId = (await tx.match.findFirst({ where: { roomId, status: 'ACTIVE' }, select: { id: true } }))?.id ?? null;
        return;
      }
      await tx.roomMember.delete({ where: { roomId_userId: { roomId, userId } } });
      if (room.ownerId !== userId) return;
      const heir = await tx.roomMember.findFirst({
        where: { roomId, user: { kind: { not: 'BOT' } } },
        orderBy: { joinedAt: 'asc' },
      });
      if (heir) {
        heirName = (await tx.user.findUnique({ where: { id: heir.userId }, select: { nickname: true } }))?.nickname ?? null;
        await tx.room.update({ where: { id: roomId }, data: { ownerId: heir.userId } });
        await tx.roomMember.update({ where: { roomId_userId: { roomId, userId: heir.userId } }, data: { ready: false } });
      } else {
        await tx.roomMember.deleteMany({ where: { roomId } });
        await tx.room.update({ where: { id: roomId }, data: { status: 'CLOSED', closedAt: new Date() } });
      }
    });
    if (playingMatchId) await this.matches.markAway(playingMatchId, userId);
    if (snap) {
      await this.chat.system(roomId, playingMatchId ? `${leaver?.nickname} 님이 자리를 비웠습니다(서버가 대신 진행).` : `${leaver?.nickname} 님이 퇴장했습니다.`);
      if (heirName) await this.chat.system(roomId, `${heirName} 님이 새 PL이 되었습니다.`);
    }
    return snap;
  }

  async setReady(roomId: string, userId: string, ready: boolean) {
    let changed = false;
    const snap = await this.mutate(roomId, async (tx, room) => {
      if (room.status !== 'WAITING') throw Errors.roomNotWaiting();
      const cur = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (!cur) throw Errors.notRoomMember();
      if (cur.ready === ready) return;
      await tx.roomMember.update({ where: { roomId_userId: { roomId, userId } }, data: { ready } });
      changed = true;
    });
    const who = snap?.members.find((m) => m.userId === userId)?.nickname;
    if (changed) await this.chat.system(roomId, `${who} 님이 ${ready ? '준비를 완료했습니다' : '준비를 취소했습니다'}.`);
    return snap;
  }

  async update(roomId: string, userId: string, input: { capacity?: number; turnTimeLimitSec?: number }) {
    const limit = input.turnTimeLimitSec === undefined ? undefined : this.checkTurnLimit(input.turnTimeLimitSec);
    return this.mutate(roomId, async (tx, room) => {
      if (room.ownerId !== userId) throw Errors.notRoomOwner();
      if (room.status !== 'WAITING') throw Errors.roomNotWaiting();
      if (input.capacity !== undefined && input.capacity < (await tx.roomMember.count({ where: { roomId } }))) {
        throw Errors.capacityBelowMembers();
      }
      await tx.room.update({ where: { id: roomId }, data: { capacity: input.capacity, turnTimeLimitSec: limit } });
    });
  }

  /**
   * 게임 시작. 방 잠금 아래에서 조건을 최종 검증한다. 이미 시작된 방이면 진행 중 게임을 그대로 돌려준다(중복 시작 방지).
   * force(테스트 모드 전용): 준비·최소 인원 조건을 건너뛴다(혼자 시작 가능).
   */
  async start(roomId: string, userId: string, opts: { force?: boolean } = {}) {
    if (opts.force && !this.env.testMode) throw Errors.testModeOnly();
    let matchId: string | null = null;
    let alreadyStarted = false;
    const snap = await this.mutate(roomId, async (tx, room) => {
      if (room.ownerId !== userId) throw Errors.notRoomOwner();
      if (room.status === 'PLAYING') {
        alreadyStarted = true;
        matchId = (await tx.match.findFirst({ where: { roomId, status: 'ACTIVE' }, select: { id: true } }))?.id ?? null;
        return;
      }
      const s = await this.snapshot(tx, roomId);
      const blockers = opts.force ? s.start.blockers.filter((b) => b === 'NOT_WAITING' || b === 'OVER_CAPACITY') : s.start.blockers;
      if (blockers.length) throw Errors.cannotStart(blockers);
      matchId = await this.matches.createInTx(tx, room, s.members.map((m) => m.userId));
      await tx.room.update({ where: { id: roomId }, data: { status: 'PLAYING' } });
    });
    const match = await this.matches.afterStart(matchId!);
    if (snap && !alreadyStarted) {
      const order = match.players.map((p) => p.nickname).join(' → ');
      const limit = match.turnTimeLimitSec % 60 === 0 ? `${match.turnTimeLimitSec / 60}분` : `${match.turnTimeLimitSec}초`;
      await this.chat.system(
        roomId,
        `평가를 시작합니다. 순서: ${order} · 턴 제한 ${limit}` + (match.phase === 'BRIEFING' ? ' · 모든 참여자가 게임 안내를 확인하면 첫 턴이 시작됩니다.' : ''),
      );
    }
    return { room: snap, match };
  }

  // ───────── 내부 ─────────

  /** 방 행을 FOR UPDATE 로 잠그고 fn 실행 → 커밋 후 room:state 브로드캐스트 */
  async mutate(
    roomId: string,
    fn: (tx: Tx, room: { id: string; status: string; ownerId: string; capacity: number; turnTimeLimitSec: number; isPrivate: boolean; joinCode: string | null }) => Promise<void>,
  ) {
    if (!uuid.safeParse(roomId).success) throw Errors.roomNotFound();
    const snap = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; status: string; owner_id: string; capacity: number; turn_time_limit_sec: number; is_private: boolean; join_code: string | null }[]>`
          SELECT id, status::text AS status, owner_id, capacity, turn_time_limit_sec, is_private, join_code FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
        const r = rows[0];
        if (!r || r.status === 'CLOSED') throw Errors.roomNotFound();
        await fn(tx, { id: r.id, status: r.status, ownerId: r.owner_id, capacity: r.capacity, turnTimeLimitSec: r.turn_time_limit_sec, isPrivate: r.is_private, joinCode: r.join_code });
        const closed = await tx.room.findUnique({ where: { id: roomId }, select: { status: true } });
        return closed?.status === 'CLOSED' ? null : this.snapshot(tx, roomId);
      },
      { timeout: 10_000 },
    );
    if (snap) this.realtime.emitToRoom(roomId, 'room:state', snap);
    this.realtime.lobbyChanged();
    return snap;
  }

  /** MatchesService 가 게임 종료 커밋 후 호출: 결과 시스템 메시지 + 로비 갱신 */
  async announce(roomId: string, text: string) {
    await this.chat.system(roomId, text);
  }

  async onMatchFinished(roomId: string, players: { nickname: string | null; total: number; rank: number | null }[]) {
    const ranking = [...players].sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99)).map((p) => `${p.rank}위 ${p.nickname} ${p.total}점`).join(' · ');
    await this.chat.system(roomId, `평가 종료 — ${ranking}`);
    this.realtime.lobbyChanged();
  }

  async broadcast(roomId: string) {
    try {
      this.realtime.emitToRoom(roomId, 'room:state', await this.snapshot(this.prisma, roomId));
    } catch {
      /* 닫힌 방 등은 무시 */
    }
  }

  private checkTurnLimit(sec: number) {
    const ok =
      RoomPolicy.turnTimeLimitOptions.includes(sec) ||
      (this.env.testMode && sec >= RoomPolicy.testTurnTimeLimitMinSec && sec <= RoomPolicy.maxTurnTimeLimitSec);
    if (!Number.isInteger(sec) || !ok) {
      throw Errors.validation([{ field: 'turnTimeLimitSec', message: `허용값: ${RoomPolicy.turnTimeLimitOptions.map((s) => s / 60 + '분').join('/')}` }]);
    }
    return sec;
  }

  private async requireProfile(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { profileCompletedAt: true, nickname: true } });
    if (!u?.profileCompletedAt) throw Errors.profileRequired();
    return u;
  }
}

/** 시작 차단 사유(서버 검증과 UI 안내에 같은 함수 사용) */
export function startBlockers(status: string, capacity: number, members: { ready: boolean; isOwner: boolean }[]) {
  const blockers: z.infer<typeof import('./room.dto.js').StartBlocker>[] = [];
  if (status !== 'WAITING') blockers.push('NOT_WAITING');
  if (members.length < RoomPolicy.minPlayersToStart) blockers.push('NOT_ENOUGH_PLAYERS');
  if (members.length > capacity) blockers.push('OVER_CAPACITY');
  if (members.some((m) => !m.isOwner && !m.ready)) blockers.push('NOT_ALL_READY');
  return { canStart: blockers.length === 0, blockers };
}

function newJoinCode(): string {
  const a = RoomPolicy.joinCodeAlphabet;
  return Array.from({ length: RoomPolicy.joinCodeLength }, () => a[randomInt(a.length)]).join('');
}
