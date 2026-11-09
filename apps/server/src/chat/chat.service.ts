import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../redis/rate-limit.service.js';
import { Errors } from '../common/app-error.js';
import { errorSummary } from '../common/util.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ChatPolicy, rankLabel } from '../game/game.policy.js';
import type { ChatMessageDto } from './chat.dto.js';

type Row = Prisma.ChatMessageGetPayload<object>;
const uuid = z.uuid();

/**
 * 방 채팅(docs/features/chat.md). 저장소는 PostgreSQL(방별 순번·중복 방지·재접속 복원),
 * 요청 제한은 Redis. 작성자는 항상 인증된 사용자로 서버가 지정한다.
 */
@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Chat');
  private cleanup: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly realtime: RealtimeService,
  ) {}

  /** 사용자 메시지. 같은 clientMessageId 재전송은 저장된 메시지를 그대로 돌려준다(중복 저장·중복 방송 없음). */
  async send(roomId: string, userId: string, input: { clientMessageId: string; text: string }): Promise<ChatMessageDto> {
    if (!uuid.safeParse(roomId).success) throw Errors.roomNotFound();
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { user: { select: { nickname: true, kind: true } }, room: { select: { status: true } } },
    });
    if (!member || member.room.status === 'CLOSED') throw Errors.notRoomMember();

    const prior = await this.prisma.chatMessage.findUnique({
      where: { roomId_userId_clientMessageId: { roomId, userId, clientMessageId: input.clientMessageId } },
    });
    if (prior) return toDto(prior);

    await this.rateLimit.consume(`chat:${userId}`, ChatPolicy.rateLimit);
    const finished = await this.prisma.matchPlayer.count({ where: { userId, match: { status: 'FINISHED' } } });
    try {
      const msg = await this.insert(roomId, {
        kind: 'TEXT',
        userId,
        senderNickname: member.user.nickname,
        senderRank: rankLabel(finished, member.user.kind),
        body: input.text,
        clientMessageId: input.clientMessageId,
      });
      this.realtime.emitToRoom(roomId, 'chat:message', msg);
      return msg;
    } catch (err) {
      // 동시 재전송 경쟁: 먼저 저장된 메시지 반환
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.chatMessage.findUnique({
          where: { roomId_userId_clientMessageId: { roomId, userId, clientMessageId: input.clientMessageId } },
        });
        if (again) return toDto(again);
      }
      throw err;
    }
  }

  /** 시스템 메시지(입장·퇴장·준비·시작·종료). 실패해도 본 동작을 막지 않는다. */
  async system(roomId: string, text: string): Promise<void> {
    try {
      const msg = await this.insert(roomId, { kind: 'SYSTEM', body: text.slice(0, 1200) });
      this.realtime.emitToRoom(roomId, 'chat:message', msg);
    } catch (err) {
      this.logger.warn(`시스템 메시지 실패 — ${errorSummary(err)}`);
    }
  }

  /** 최근 메시지(오름차순). beforeSeq: 그 이전 페이지, afterSeq: 그 이후(재접속 누락 보충) */
  async history(roomId: string, userId: string, q: { beforeSeq?: number; afterSeq?: number; limit: number }) {
    if (!uuid.safeParse(roomId).success) throw Errors.roomNotFound();
    const member = await this.prisma.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!member) throw Errors.notRoomMember();
    return this.recent(roomId, q);
  }

  async recent(roomId: string, q: { beforeSeq?: number; afterSeq?: number; limit: number } = { limit: ChatPolicy.historyLimit }) {
    if (q.afterSeq !== undefined) {
      const rows = await this.prisma.chatMessage.findMany({ where: { roomId, seq: { gt: q.afterSeq } }, orderBy: { seq: 'asc' }, take: q.limit + 1 });
      return { items: rows.slice(0, q.limit).map(toDto), hasMore: rows.length > q.limit };
    }
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId, ...(q.beforeSeq !== undefined ? { seq: { lt: q.beforeSeq } } : {}) },
      orderBy: { seq: 'desc' },
      take: q.limit + 1,
    });
    return { items: rows.slice(0, q.limit).reverse().map(toDto), hasMore: rows.length > q.limit };
  }

  /** 방 카운터를 원자적으로 증가시키고 같은 트랜잭션에서 저장 → 방별 seq 가 빈틈·중복 없이 증가 */
  private async insert(roomId: string, data: Omit<Prisma.ChatMessageUncheckedCreateInput, 'roomId' | 'seq'>) {
    const row = await this.prisma.$transaction(async (tx) => {
      const [c] = await tx.$queryRaw<{ chat_seq: number }[]>`UPDATE rooms SET chat_seq = chat_seq + 1 WHERE id = ${roomId}::uuid RETURNING chat_seq`;
      if (!c) throw Errors.roomNotFound();
      return tx.chatMessage.create({ data: { ...data, roomId, seq: c.chat_seq } });
    });
    return toDto(row);
  }

  /** 보관 기간(기본 30일)이 지난 메시지 삭제 — 필요 이상 보관하지 않음 */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - ChatPolicy.retentionDays * 86_400_000);
    const res = await this.prisma.chatMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (res.count) this.logger.log(`보관 기간 지난 메시지 ${res.count}건 삭제`);
    return res.count;
  }

  onModuleInit() {
    this.cleanup = setInterval(() => void this.purgeExpired().catch(() => {}), ChatPolicy.cleanupIntervalMs);
    this.cleanup.unref();
  }

  onModuleDestroy() {
    if (this.cleanup) clearInterval(this.cleanup);
  }
}

function toDto(r: Row): ChatMessageDto {
  return {
    id: r.id,
    roomId: r.roomId,
    seq: r.seq,
    kind: r.kind,
    userId: r.userId,
    nickname: r.senderNickname,
    rankLabel: r.senderRank,
    text: r.body,
    clientMessageId: r.clientMessageId,
    createdAt: r.createdAt.toISOString(),
  };
}
