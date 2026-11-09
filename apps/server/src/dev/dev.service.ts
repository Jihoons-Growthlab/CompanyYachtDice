import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Errors } from '../common/app-error.js';
import { AuthService, type ClientMeta } from '../auth/auth.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { MatchesService } from '../matches/matches.service.js';
import { RoomPolicy } from '../game/game.policy.js';

/** 고정 ID: 테스트 계정 d1–d6, 봇 b1–b5 (재생성해도 같은 계정 → 간편 로그인 안정) */
const devId = (slot: number) => `00000000-0000-7000-8000-0000000000d${slot}`;
const DEPTS = ['기획', '개발', '디자인', '영업', '인사', '재무·회계'];
export const DEV_SLOTS = 6;
const BOTS = 5;

export type DevProfile = { nickname?: string; departmentLabel?: string };

/**
 * 개발자 테스트 모드 전용 기능. 실제 방·게임 서비스와 엔진을 그대로 호출하고 우회는 '조건 완화'만 한다
 * (점수·주사위를 임의로 정하지 않음). DevModule 은 env.testMode 일 때만 등록된다.
 */
@Injectable()
export class DevService {
  private readonly logger = new Logger('Dev');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
    private readonly matches: MatchesService,
  ) {}

  async status() {
    const accounts = await this.listAccounts();
    return {
      testMode: true,
      accounts,
      unavailable: [
        { feature: 'wallet', reason: '서버 재화·아이템 기능 미구현(economy)' },
        { feature: 'companyApproval', reason: '서버 회사 클랜 기능 미구현(organization)' },
        { feature: 'rankOverride', reason: '직급 마스터 미정(Q8·Q9) — 완주 수 기반 계산값만 표시' },
      ],
    };
  }

  async listAccounts() {
    const users = await this.prisma.user.findMany({ where: { kind: 'DEV' }, orderBy: { id: 'asc' } });
    return users.map((u) => ({ slot: Number(u.id.slice(-1)), userId: u.id, nickname: u.nickname, departmentLabel: u.departmentLabel }));
  }

  /** 테스트 계정 1–6개 생성·갱신(프로필 완료 상태) */
  async ensureAccounts(count: number, profiles: DevProfile[] = []) {
    for (let slot = 1; slot <= count; slot++) {
      const p = profiles[slot - 1] ?? {};
      const data = {
        nickname: p.nickname ?? `테스트사원${slot}`,
        departmentLabel: p.departmentLabel ?? DEPTS[slot - 1]!,
        profileCompletedAt: new Date(),
      };
      await this.prisma.user.upsert({
        where: { id: devId(slot) },
        create: { id: devId(slot), kind: 'DEV', ...data },
        update: profiles[slot - 1] ? data : {},
      });
    }
    return this.listAccounts();
  }

  async login(slot: number, meta: ClientMeta) {
    await this.ensureAccounts(slot);
    return this.auth.issueSession(devId(slot), meta);
  }

  async createTestRoom(userId: string, input: { name?: string; capacity: number; turnTimeLimitSec?: number; bots: number; start: boolean }) {
    let room = await this.rooms.create(
      userId,
      { name: input.name ?? `테스트 평가실 ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`, capacity: input.capacity, turnTimeLimitSec: input.turnTimeLimitSec },
      { isTest: true },
    );
    if (input.bots > 0) room = (await this.addBots(room.id, userId, input.bots)) ?? room;
    if (!input.start) return { room, match: null };
    return this.forceStart(room.id, userId);
  }

  /** 가상 플레이어(봇) 추가: 자동 준비 상태로 입장, 정원까지 */
  async addBots(roomId: string, userId: string, count: number) {
    const snap = await this.rooms.get(roomId, userId);
    if (snap.ownerId !== userId) throw Errors.notRoomOwner();
    const present = new Set(snap.members.map((m) => m.userId));
    const free = (await this.rooms.ensureBots()).filter((id) => !present.has(id));
    const room = snap.capacity - snap.members.length;
    const n = Math.min(count, room, free.length);
    for (const id of free.slice(0, n)) await this.rooms.join(roomId, id, { ready: true, trusted: true });
    return this.rooms.get(roomId, userId);
  }

  /** 다른 테스트 계정을 실제 참여자로 입장(초대 수락 우회). 해당 계정으로 로그인하면 직접 조작 가능. */
  async addDevMember(roomId: string, userId: string, slot: number, ready: boolean) {
    const snap = await this.rooms.get(roomId, userId);
    if (snap.ownerId !== userId) throw Errors.notRoomOwner();
    await this.ensureAccounts(slot);
    await this.rooms.join(roomId, devId(slot), { ready, trusted: true });
    return this.rooms.get(roomId, userId);
  }

  async readyAll(roomId: string, userId: string) {
    const snap = await this.rooms.get(roomId, userId);
    if (snap.ownerId !== userId) throw Errors.notRoomOwner();
    return this.rooms.mutate(roomId, async (tx, room) => {
      if (room.status !== 'WAITING') throw Errors.roomNotWaiting();
      await tx.roomMember.updateMany({ where: { roomId }, data: { ready: true } });
    });
  }

  /** 개발 전용 강제 시작: 준비·최소 인원 조건 생략(혼자 시작 가능). 정원·방장 검사는 유지. */
  forceStart(roomId: string, userId: string) {
    return this.rooms.start(roomId, userId, { force: true });
  }

  async finish(matchId: string, userId: string) {
    await this.matches.get(matchId, userId); // 참여자 확인
    return this.matches.simulateToEnd(matchId);
  }

  /** 테스트 데이터 초기화: 테스트 방(및 게임)과 봇·테스트 계정의 대기실 참여만 삭제. 실제 사용자 데이터는 건드리지 않는다. */
  async reset(opts: { accounts: boolean }) {
    const testUsers = await this.prisma.user.findMany({ where: { kind: { in: ['DEV', 'BOT'] } }, select: { id: true } });
    const ids = testUsers.map((u) => u.id);
    const rooms = await this.prisma.room.deleteMany({ where: { OR: [{ isTest: true }, { ownerId: { in: ids } }] } });
    const memberships = await this.prisma.roomMember.deleteMany({ where: { userId: { in: ids }, room: { status: 'WAITING' } } });
    const users = opts.accounts ? await this.prisma.user.deleteMany({ where: { id: { in: ids }, matchSeats: { none: {} } } }) : { count: 0 };
    this.logger.log(`reset: rooms=${rooms.count} memberships=${memberships.count} users=${users.count}`);
    return { deletedRooms: rooms.count, removedMemberships: memberships.count, deletedAccounts: users.count };
  }

}

export const DevLimits = { maxBots: BOTS, maxCapacity: RoomPolicy.maxCapacity };
