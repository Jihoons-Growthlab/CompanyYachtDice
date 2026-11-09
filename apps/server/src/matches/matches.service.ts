import { createHash, randomInt } from 'node:crypto';
import { forwardRef, Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Errors } from '../common/app-error.js';
import { errorSummary, type Ref } from '../common/util.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { GamePolicy } from '../game/game.policy.js';
import {
  applyCommand,
  bestCategory,
  bonus,
  CATEGORY_KEYS,
  createGame,
  currentPlayerId,
  nextAutoCommand,
  previews,
  rollDie,
  total,
  upper,
  type Command,
  type GameState,
} from '../game/engine.js';
import { RoomsService } from '../rooms/rooms.service.js';
import type { MatchCommandInput, MatchSnapshot } from './match.dto.js';

type Tx = Prisma.TransactionClient;
type PlayerRow = {
  userId: string;
  seat: number;
  playMode: 'MANUAL' | 'AUTO' | 'AWAY';
  consecutiveTimeouts: number;
  autoTurns: number;
  total: number | null;
  rank: number | null;
  briefedAt: Date | null;
  user: { nickname: string | null; kind: 'HUMAN' | 'DEV' | 'BOT' };
};
type MatchRow = {
  id: string;
  roomId: string;
  status: 'ACTIVE' | 'FINISHED' | 'ABORTED';
  ruleset: string;
  version: number;
  state: GameState;
  turnTimeLimitSec: number;
  turnDeadlineAt: Date | null;
  briefingDeadlineAt: Date | null;
  players: PlayerRow[];
};
type PlayerPatch = Partial<Pick<PlayerRow, 'playMode' | 'consecutiveTimeouts' | 'autoTurns' | 'briefedAt'>>;
/** mutate 콜백 결과. null = 변경 없음. beginTurns = 안내 단계를 끝내고 첫 턴 기한 시작 */
type Change = {
  state?: GameState;
  patches?: Record<string, PlayerPatch>;
  receipt?: { userId: string; commandId: string; requestHash: string };
  beginTurns?: boolean;
} | null;

const uuid = z.uuid();
const SCORE_BEST = 'SCORE_BEST';

@Injectable()
export class MatchesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Matches');
  private readonly timers = new Map<string, { deadline?: NodeJS.Timeout; auto?: NodeJS.Timeout }>();
  private stopped = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(forwardRef(() => RoomsService)) private readonly rooms: Ref<RoomsService>,
  ) {}

  // ───────── 시작 ─────────

  /** RoomsService.start 의 트랜잭션 안에서 호출: 좌석을 서버 난수로 섞고 엔진 상태를 만든다. */
  async createInTx(tx: Tx, room: { id: string; turnTimeLimitSec: number }, memberIds: string[]): Promise<string> {
    const order = [...memberIds];
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const state = createGame(order);
    const now = Date.now();
    const bots = new Set((await tx.user.findMany({ where: { id: { in: order }, kind: 'BOT' }, select: { id: true } })).map((u) => u.id));
    // 안내 단계: 사람 참여자가 모두 확인할 때까지 첫 턴 기한을 정하지 않는다(타이머 미진행). 사람이 없으면 바로 시작.
    const briefing = this.env.BRIEFING_ENABLED && order.some((id) => !bots.has(id));
    const match = await tx.match.create({
      data: {
        roomId: room.id,
        state: state as unknown as Prisma.InputJsonValue,
        turnTimeLimitSec: room.turnTimeLimitSec,
        turnDeadlineAt: briefing ? null : new Date(now + room.turnTimeLimitSec * 1000),
        briefingDeadlineAt: briefing ? new Date(now + this.env.BRIEFING_TIMEOUT_SEC * 1000) : null,
        players: {
          create: order.map((userId, seat) => ({ userId, seat, briefedAt: !briefing || bots.has(userId) ? new Date(now) : null })),
        },
      },
    });
    await tx.roomMember.updateMany({ where: { roomId: room.id }, data: { ready: false } });
    return match.id;
  }

  /** 커밋 후: 시작 이벤트 브로드캐스트 + 타이머 */
  async afterStart(matchId: string) {
    const snap = await this.snapshotById(this.prisma, matchId);
    this.realtime.emitToRoom(snap.roomId, 'match:state', snap);
    await this.reschedule(matchId);
    return snap;
  }

  // ───────── 조회·명령 ─────────

  async get(matchId: string, userId: string): Promise<MatchSnapshot> {
    const m = await this.load(this.prisma, matchId);
    if (!m.players.some((p) => p.userId === userId)) {
      const member = await this.prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: m.roomId, userId } } });
      if (!member) throw Errors.notMatchPlayer();
    }
    return this.toSnapshot(m);
  }

  /** 플레이어 수동 명령. 같은 commandId 재전송은 상태를 바꾸지 않고 현재 스냅샷을 돌려준다. */
  async command(matchId: string, userId: string, input: MatchCommandInput): Promise<MatchSnapshot> {
    const cmd: Command =
      input.type === 'HOLD' ? { type: 'HOLD', held: input.held } : input.type === 'SCORE' ? { type: 'SCORE', category: input.category } : { type: 'ROLL' };
    const requestHash = createHash('sha256').update(JSON.stringify(cmd)).digest('hex');
    return this.mutate(matchId, async (tx, m) => {
      const me = m.players.find((p) => p.userId === userId);
      if (!me) throw Errors.notMatchPlayer();
      const prior = await tx.matchCommand.findUnique({ where: { matchId_userId_commandId: { matchId, userId, commandId: input.commandId } } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw Errors.idempotencyConflict();
        return null; // 재전송: 이미 처리됨
      }
      if (m.briefingDeadlineAt) throw Errors.gameRule('BRIEFING_IN_PROGRESS');
      if (m.version !== input.expectedVersion) throw Errors.staleVersion(m.version);
      const r = applyCommand(m.state, userId, cmd, rollDie);
      if (!r.ok) throw Errors.gameRule(r.code);
      const patch: PlayerPatch = { consecutiveTimeouts: 0 };
      if (me.playMode === 'AWAY' && GamePolicy.returnToManualOnInput) patch.playMode = 'MANUAL';
      return { state: r.state, patches: { [userId]: patch }, receipt: { userId, commandId: input.commandId, requestHash } };
    });
  }

  /** 자발적 오토(AUTO) 켜기/끄기. AWAY 도 MANUAL 로 복귀. */
  async setMode(matchId: string, userId: string, mode: 'MANUAL' | 'AUTO') {
    return this.mutate(matchId, async (_tx, m) => {
      const me = m.players.find((p) => p.userId === userId);
      if (!me) throw Errors.notMatchPlayer();
      if (m.status !== 'ACTIVE') throw Errors.gameRule('MATCH_FINISHED');
      if (me.playMode === mode) return null;
      return { patches: { [userId]: { playMode: mode, consecutiveTimeouts: 0 } } };
    });
  }

  /** 시작 안내 확인(또는 건너뛰기). 마지막 사람이 확인하면 첫 턴 시작. 안내 단계가 아니면 아무 일도 없다(멱등). */
  async briefed(matchId: string, userId: string) {
    return this.mutate(matchId, async (_tx, m) => {
      const me = m.players.find((p) => p.userId === userId);
      if (!me) throw Errors.notMatchPlayer();
      if (!m.briefingDeadlineAt || me.briefedAt) return null;
      return { patches: { [userId]: { briefedAt: new Date() } }, beginTurns: allBriefed(m.players, userId) };
    });
  }

  /** 진행 중 퇴장 → 자리 비움. 안내 단계에서 나가면 확인한 것으로 보고 다른 사람을 기다리게 하지 않는다. */
  async markAway(matchId: string, userId: string) {
    await this.mutate(matchId, async (_tx, m) => {
      const me = m.players.find((p) => p.userId === userId);
      if (!me || m.status !== 'ACTIVE' || me.playMode === 'AWAY') return null;
      const briefing = !!m.briefingDeadlineAt && !me.briefedAt;
      return {
        patches: { [userId]: { playMode: 'AWAY', ...(briefing ? { briefedAt: new Date() } : {}) } },
        beginTurns: briefing && allBriefed(m.players, userId),
      };
    });
  }

  /** 안내 대기 기한 초과: 확인하지 않은 참여자가 있어도 시작(이탈·무응답 대비). 그 참여자는 이후 시간 초과 규칙을 따른다. */
  private async onBriefingTimeout(matchId: string) {
    await this.mutate(matchId, async (_tx, m) => {
      if (m.status !== 'ACTIVE' || !m.briefingDeadlineAt || m.briefingDeadlineAt.getTime() > Date.now() + 50) return null;
      this.logger.log(`match ${matchId}: 안내 대기 시간 초과 → 시작`);
      return { beginTurns: true };
    }, { system: true });
  }

  /** (테스트 모드) 남은 턴을 모두 오토 전략으로 진행해 종료까지 시뮬레이션 — 엔진 규칙 그대로 */
  async simulateToEnd(matchId: string) {
    if (!this.env.testMode) throw Errors.testModeOnly();
    return this.mutate(matchId, async (_tx, m) => {
      if (m.status !== 'ACTIVE') return null;
      let state = m.state;
      void m.briefingDeadlineAt; // 안내 단계여도 종료 시뮬레이션은 진행(mutate 가 안내 기한을 정리)
      for (let guard = 0; state.status === 'ACTIVE' && guard < 20_000; guard++) {
        const r = applyCommand(state, currentPlayerId(state)!, nextAutoCommand(state), rollDie);
        if (!r.ok) throw new Error(`auto command rejected: ${r.code}`);
        state = r.state;
      }
      return { state };
    });
  }

  // ───────── 서버 진행: 시간 초과·봇·오토 ─────────

  private async onTimeout(matchId: string, version: number) {
    await this.mutate(matchId, async (_tx, m) => {
      if (m.status !== 'ACTIVE' || m.version !== version) return null;
      if (!m.turnDeadlineAt || m.turnDeadlineAt.getTime() > Date.now() + 50) return null;
      const pid = currentPlayerId(m.state)!;
      const p = m.players.find((x) => x.userId === pid)!;
      const state = this.autoFinishTurn(m.state, pid);
      const timeouts = p.consecutiveTimeouts + 1;
      const toAway = p.user.kind !== 'BOT' && p.playMode === 'MANUAL' && timeouts >= GamePolicy.timeoutsBeforeAway;
      if (toAway) this.logger.log(`match ${matchId}: ${pid} 연속 시간 초과 ${timeouts}회 → AWAY`);
      return { state, patches: { [pid]: { consecutiveTimeouts: timeouts, autoTurns: p.autoTurns + 1, ...(toAway ? { playMode: 'AWAY' as const } : {}) } } };
    }, { system: true });
  }

  private async onAutoStep(matchId: string, version: number) {
    await this.mutate(matchId, async (_tx, m) => {
      if (m.status !== 'ACTIVE' || m.version !== version || m.briefingDeadlineAt) return null;
      const pid = currentPlayerId(m.state)!;
      const p = m.players.find((x) => x.userId === pid)!;
      if (p.user.kind !== 'BOT' && p.playMode === 'MANUAL') return null;
      const cmd = nextAutoCommand(m.state);
      const r = applyCommand(m.state, pid, cmd, rollDie);
      const state = r.ok ? r.state : this.autoFinishTurn(m.state, pid);
      const scored = !r.ok || cmd.type === 'SCORE';
      return scored && p.user.kind !== 'BOT' ? { state, patches: { [pid]: { autoTurns: p.autoTurns + 1 } } } : { state };
    }, { system: true });
  }

  /** 시간 초과 처리 규칙(GamePolicy.timeoutAction): 굴림이 없으면 1회 굴리고 최고점 칸 확정 */
  private autoFinishTurn(state: GameState, pid: string): GameState {
    let s = state;
    if (s.rollCount === 0) {
      const r = applyCommand(s, pid, { type: 'ROLL' }, rollDie);
      if (!r.ok) throw new Error(r.code);
      s = r.state;
    }
    const category = bestCategory(s.players[s.turn]!.card, s.dice)!;
    const r = applyCommand(s, pid, { type: 'SCORE', category }, rollDie);
    if (!r.ok) throw new Error(`${SCORE_BEST}: ${r.code}`);
    return r.state;
  }

  private async reschedule(matchId: string) {
    this.clearTimers(matchId);
    if (this.stopped) return;
    const m = await this.load(this.prisma, matchId).catch(() => null);
    if (!m || m.status !== 'ACTIVE') return;
    const t: { deadline?: NodeJS.Timeout; auto?: NodeJS.Timeout } = {};
    if (m.briefingDeadlineAt) {
      // 안내 단계: 턴·봇 타이머 없이 안내 기한만
      t.deadline = setTimeout(() => this.safe(() => this.onBriefingTimeout(matchId)), Math.max(0, m.briefingDeadlineAt.getTime() - Date.now()));
      this.timers.set(matchId, t);
      return;
    }
    if (m.turnDeadlineAt) {
      const delay = Math.max(0, m.turnDeadlineAt.getTime() - Date.now());
      t.deadline = setTimeout(() => this.safe(() => this.onTimeout(matchId, m.version)), delay);
    }
    const p = m.players.find((x) => x.userId === currentPlayerId(m.state));
    if (p && (p.user.kind === 'BOT' || p.playMode !== 'MANUAL')) {
      // 턴 첫 동작은 더 길게 쉬어 다음 플레이어 전환이 보이게 한다(UI 템포, 게임 기한과 무관)
      const delay = m.state.rollCount === 0 ? this.env.AUTO_TURN_START_DELAY_MS : this.env.AUTO_STEP_DELAY_MS;
      t.auto = setTimeout(() => this.safe(() => this.onAutoStep(matchId, m.version)), delay);
    }
    this.timers.set(matchId, t);
  }

  private clearTimers(matchId: string) {
    const t = this.timers.get(matchId);
    if (t?.deadline) clearTimeout(t.deadline);
    if (t?.auto) clearTimeout(t.auto);
    this.timers.delete(matchId);
  }

  private safe(fn: () => Promise<unknown>) {
    if (this.stopped) return;
    fn().catch((err) => this.logger.warn(`타이머 처리 실패 — ${errorSummary(err)}`));
  }

  /** 재시작 복구: 진행 중 게임의 기한·오토 타이머를 DB 기준으로 다시 건다(지난 기한은 즉시 처리) */
  async onApplicationBootstrap() {
    const active = await this.prisma.match.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }).catch(() => []);
    for (const { id } of active) await this.reschedule(id);
    if (active.length) this.logger.log(`진행 중 게임 ${active.length}개 타이머 복구`);
  }

  onModuleDestroy() {
    this.stopped = true;
    for (const id of [...this.timers.keys()]) this.clearTimers(id);
  }

  // ───────── 공통 변경 파이프라인 ─────────

  /**
   * 매치 행 잠금 → 콜백(검증·엔진) → 상태·version·기한·플레이어·영수증 저장 → 종료 정산 → 커밋
   * → 커밋 후 브로드캐스트·타이머 재설정. 콜백이 null 이면 변경 없이 현재 스냅샷 반환.
   */
  private async mutate(matchId: string, fn: (tx: Tx, m: MatchRow) => Promise<Change>, opts: { system?: boolean } = {}): Promise<MatchSnapshot> {
    if (!uuid.safeParse(matchId).success) throw Errors.matchNotFound();
    const { snap, changed, finished, began } = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM matches WHERE id = ${matchId}::uuid FOR UPDATE`;
        if (!locked.length) throw Errors.matchNotFound();
        const m = await this.load(tx, matchId);
        const change = await fn(tx, m);
        if (!change) return { snap: this.toSnapshot(m), changed: false, finished: false, began: false };

        const prev = m.state;
        const state = change.state ?? prev;
        const version = m.version + 1;
        const turnChanged = state.turn !== prev.turn || state.round !== prev.round || state.status !== prev.status;
        const done = state.status === 'FINISHED';
        const begin = !!m.briefingDeadlineAt && (change.beginTurns || done || state !== prev);
        const deadline = done ? null : turnChanged || begin ? new Date(Date.now() + m.turnTimeLimitSec * 1000) : m.turnDeadlineAt;
        await tx.match.update({
          where: { id: matchId },
          data: {
            state: state as unknown as Prisma.InputJsonValue,
            version,
            turnDeadlineAt: deadline,
            ...(begin ? { briefingDeadlineAt: null } : {}),
            ...(done ? { status: 'FINISHED', finishedAt: new Date() } : {}),
          },
        });
        for (const [userId, patch] of Object.entries(change.patches ?? {})) {
          await tx.matchPlayer.update({ where: { matchId_userId: { matchId, userId } }, data: patch });
        }
        if (change.receipt) {
          await tx.matchCommand.create({ data: { matchId, ...change.receipt, resultVersion: version } });
        }
        if (done) {
          for (const r of state.results ?? []) {
            await tx.matchPlayer.update({ where: { matchId_userId: { matchId, userId: r.id } }, data: { total: r.total, rank: r.rank } });
          }
          // 같은 방에서 다시 시작할 수 있도록 대기 상태로 복귀(사람은 준비 해제, 봇은 준비 유지)
          await tx.room.update({ where: { id: m.roomId }, data: { status: 'WAITING' } });
          await tx.roomMember.updateMany({ where: { roomId: m.roomId, user: { kind: { not: 'BOT' } } }, data: { ready: false } });
          await tx.roomMember.updateMany({ where: { roomId: m.roomId, user: { kind: 'BOT' } }, data: { ready: true } });
        }
        return { snap: this.toSnapshot(await this.load(tx, matchId)), changed: true, finished: done, began: begin && !done };
      },
      { timeout: 10_000 },
    );
    if (changed) {
      this.realtime.emitToRoom(snap.roomId, 'match:state', snap);
      if (began) await this.rooms.announce(snap.roomId, `안내 확인 완료 — 첫 턴: ${snap.players.find((p) => p.userId === snap.turnUserId)?.nickname} (턴 제한 ${formatLimit(snap.turnTimeLimitSec)})`);
      if (finished) {
        await this.rooms.broadcast(snap.roomId);
        await this.rooms.onMatchFinished(snap.roomId, snap.players);
      }
      await this.reschedule(matchId);
    }
    void opts;
    return snap;
  }

  private async load(db: Tx | PrismaService, matchId: string): Promise<MatchRow> {
    if (!uuid.safeParse(matchId).success) throw Errors.matchNotFound();
    const m = await db.match.findUnique({
      where: { id: matchId },
      include: { players: { orderBy: { seat: 'asc' }, include: { user: { select: { nickname: true, kind: true } } } } },
    });
    if (!m) throw Errors.matchNotFound();
    return { ...m, state: m.state as unknown as GameState } as MatchRow;
  }

  private async snapshotById(db: Tx | PrismaService, matchId: string) {
    return this.toSnapshot(await this.load(db, matchId));
  }

  private toSnapshot(m: MatchRow): MatchSnapshot {
    const s = m.state;
    const cards = new Map(s.players.map((p) => [p.id, p.card]));
    const ranks = new Map((s.results ?? []).map((r) => [r.id, r.rank]));
    const briefing = m.status === 'ACTIVE' && !!m.briefingDeadlineAt;
    return {
      id: m.id,
      roomId: m.roomId,
      ruleset: m.ruleset,
      status: m.status,
      phase: briefing ? 'BRIEFING' : m.status === 'ACTIVE' ? 'PLAYING' : 'FINISHED',
      briefingDeadlineAt: briefing ? m.briefingDeadlineAt!.toISOString() : null,
      version: m.version,
      round: s.round,
      totalRounds: CATEGORY_KEYS.length,
      turnUserId: m.status === 'ACTIVE' ? currentPlayerId(s) : null,
      turnDeadlineAt: m.status === 'ACTIVE' && !briefing ? (m.turnDeadlineAt?.toISOString() ?? null) : null,
      turnTimeLimitSec: m.turnTimeLimitSec,
      serverTime: new Date().toISOString(),
      dice: s.dice,
      held: s.held,
      rollCount: s.rollCount,
      maxRolls: 3,
      previews: m.status === 'ACTIVE' ? (previews(s) as Record<string, number>) : {},
      players: m.players.map((p) => {
        const card = cards.get(p.userId) ?? {};
        return {
          userId: p.userId,
          nickname: p.user.nickname,
          isBot: p.user.kind === 'BOT',
          seat: p.seat,
          playMode: p.playMode,
          briefed: !!p.briefedAt,
          scores: Object.fromEntries(CATEGORY_KEYS.map((k) => [k, card[k] ?? null])) as MatchSnapshot['players'][number]['scores'],
          upper: upper(card),
          bonus: bonus(card),
          total: total(card),
          rank: ranks.get(p.userId) ?? null,
        };
      }),
    };
  }
}

/** 이번 확인으로 모든 참여자가 안내를 확인하게 되는가 */
function allBriefed(players: { userId: string; briefedAt: Date | null }[], nowBriefed: string) {
  return players.every((p) => p.userId === nowBriefed || !!p.briefedAt);
}

const formatLimit = (sec: number) => (sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`);
