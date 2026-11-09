import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Errors } from '../common/app-error.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { ChatService } from '../chat/chat.service.js';
import { InvitePolicy } from '../game/game.policy.js';

const uuid = z.uuid();
export type InviteDto = {
  id: string;
  roomId: string;
  roomName: string;
  inviterNickname: string | null;
  targetUserId: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

/**
 * 게임방 초대(lobby.md "평가실 대기 흐름"): PL 이 특정 사원에게 참석 요청 → 대상이 수락하면 서버가 WAITING·정원을 재검사해 입장.
 * 초대 발송은 좌석을 보장하지 않는다. (room,target) PENDING 은 하나(DB 부분 UNIQUE). 만료는 조회·응답 시 지연 처리.
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly rooms: RoomsService,
    private readonly chat: ChatService,
  ) {}

  /** 사원명 검색(인사 등록 완료, 봇 제외, 본인 제외) + 온라인 여부 */
  async searchUsers(q: string, me: string) {
    const term = q.trim();
    if (!term) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { not: me }, kind: { not: 'BOT' }, profileCompletedAt: { not: null }, nickname: { contains: term, mode: 'insensitive' } },
      orderBy: { nickname: 'asc' },
      take: InvitePolicy.searchLimit,
      select: { id: true, nickname: true, departmentLabel: true },
    });
    return users.map((u) => ({ userId: u.id, nickname: u.nickname, departmentLabel: u.departmentLabel, online: this.realtime.isOnline(u.id) }));
  }

  async create(roomId: string, inviterId: string, targetUserId: string): Promise<InviteDto> {
    const room = await this.rooms.get(roomId, inviterId);
    if (room.ownerId !== inviterId) throw Errors.notRoomOwner();
    if (room.status !== 'WAITING') throw Errors.roomNotWaiting();
    if (targetUserId === inviterId || room.members.some((m) => m.userId === targetUserId)) throw Errors.inviteInvalidTarget();
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { kind: true, profileCompletedAt: true, nickname: true } });
    if (!target || target.kind === 'BOT' || !target.profileCompletedAt) throw Errors.inviteInvalidTarget();

    await this.expireStale({ roomId, targetUserId });
    const existing = await this.prisma.roomInvite.findFirst({ where: { roomId, targetUserId, status: 'PENDING' } });
    if (existing) return this.dto(existing.id); // 중복 초대: 기존 초대를 그대로 반환
    let id: string;
    try {
      id = (
        await this.prisma.roomInvite.create({
          data: { roomId, inviterId, targetUserId, expiresAt: new Date(Date.now() + InvitePolicy.ttlMinutes * 60_000) },
        })
      ).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.dto((await this.prisma.roomInvite.findFirstOrThrow({ where: { roomId, targetUserId, status: 'PENDING' } })).id);
      }
      throw err;
    }
    const dto = await this.dto(id);
    this.realtime.emitToUser(targetUserId, 'invite:received', dto);
    await this.chat.system(roomId, `${target.nickname} 님에게 참석 요청을 보냈습니다.`);
    return dto;
  }

  async listMine(userId: string): Promise<InviteDto[]> {
    await this.expireStale({ targetUserId: userId });
    const rows = await this.prisma.roomInvite.findMany({
      where: { targetUserId: userId, status: 'PENDING', room: { status: { not: 'CLOSED' } } },
      orderBy: { createdAt: 'desc' },
      include: { room: { select: { name: true } }, inviter: { select: { nickname: true } } },
    });
    return rows.map(toDto);
  }

  /** 수락: 초대 행 잠금 → 대상·상태·만료 확인 → 방 입장(정원·WAITING 재검사, 비공개 코드 생략) → ACCEPTED */
  async respond(inviteId: string, userId: string, accept: boolean) {
    if (!uuid.safeParse(inviteId).success) throw Errors.inviteNotFound();
    const inv = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM room_invites WHERE id = ${inviteId}::uuid FOR UPDATE`;
      if (!rows.length) throw Errors.inviteNotFound();
      const i = await tx.roomInvite.findUniqueOrThrow({ where: { id: inviteId } });
      if (i.targetUserId !== userId) throw Errors.inviteNotFound();
      if (i.status !== 'PENDING') throw Errors.inviteNotPending();
      if (i.expiresAt <= new Date()) {
        await tx.roomInvite.update({ where: { id: inviteId }, data: { status: 'EXPIRED' } });
        return { ...i, status: 'EXPIRED' as const };
      }
      if (!accept) await tx.roomInvite.update({ where: { id: inviteId }, data: { status: 'DECLINED', respondedAt: new Date() } });
      return i;
    });
    if (inv.status === 'EXPIRED') throw Errors.inviteExpired();
    if (!accept) {
      this.realtime.emitToUser(inv.inviterId, 'invite:updated', await this.dto(inviteId));
      return { invite: await this.dto(inviteId), room: null };
    }
    const room = await this.rooms.join(inv.roomId, userId, { trusted: true }); // 실패(정원·진행 중) 시 초대는 PENDING 유지
    await this.prisma.roomInvite.updateMany({ where: { id: inviteId, status: 'PENDING' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    const dto = await this.dto(inviteId);
    this.realtime.emitToUser(inv.inviterId, 'invite:updated', dto);
    return { invite: dto, room };
  }

  private async expireStale(where: { roomId?: string; targetUserId: string }) {
    await this.prisma.roomInvite.updateMany({ where: { ...where, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
  }

  private async dto(id: string) {
    const r = await this.prisma.roomInvite.findUniqueOrThrow({
      where: { id },
      include: { room: { select: { name: true } }, inviter: { select: { nickname: true } } },
    });
    return toDto(r);
  }
}

function toDto(r: Prisma.RoomInviteGetPayload<{ include: { room: { select: { name: true } }; inviter: { select: { nickname: true } } } }>): InviteDto {
  return {
    id: r.id,
    roomId: r.roomId,
    roomName: r.room.name,
    inviterNickname: r.inviter.nickname,
    targetUserId: r.targetUserId,
    status: r.status,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
