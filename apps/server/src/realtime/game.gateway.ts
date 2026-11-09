import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, type OnGatewayConnection, type OnGatewayDisconnect, type OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ChatService } from '../chat/chat.service.js';
import { SendMessageInput } from '../chat/chat.dto.js';
import type { Server, Socket } from 'socket.io';
import { AppError } from '../common/app-error.js';
import { parseInput } from '../common/validation.js';
import { errorSummary } from '../common/util.js';
import { AuthService } from '../auth/auth.service.js';
import { TokenService } from '../auth/token.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { MatchesService } from '../matches/matches.service.js';
import { MatchCommandInput, PlayModeInput } from '../matches/match.dto.js';
import { ReadyInput } from '../rooms/room.dto.js';
import { z } from 'zod';
import { channel, RealtimeService, userChannel } from './realtime.service.js';

type Ack = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } };
const RoomRef = z.object({ roomId: z.uuid() });
const MatchRef = z.object({ matchId: z.uuid() });

/**
 * Socket.IO 계약 v1 (docs/contracts/socket.md). 인증: handshake `auth.token` = access JWT.
 * Origin 은 SocketIoAdapter(allowRequest)에서 HTTP 와 같은 규칙으로 검사한다.
 */
@WebSocketGateway()
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('Gateway');

  constructor(
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeService,
    private readonly rooms: RoomsService,
    private readonly matches: MatchesService,
    private readonly chat: ChatService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
    // 연결 수립 전에 인증(미인증 소켓은 이벤트를 보낼 수 없음). 실패 시 클라이언트는 connect_error 를 받는다.
    server.use((socket, next) => {
      void (async () => {
        try {
          const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
          if (!token) throw new AppError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
          const claims = await this.tokens.verifyAccess(token);
          if (!(await this.auth.isSessionFamilyActive(claims.sessionFamilyId))) throw new AppError(401, 'SESSION_REVOKED', '로그아웃된 세션입니다.');
          socket.data.userId = claims.userId;
          socket.data.rooms = new Set<string>();
          // access token 만료 시 연결 종료 → 클라이언트가 refresh 후 재연결
          const ms = claims.exp * 1000 - Date.now();
          const t = setTimeout(() => socket.disconnect(true), Math.max(0, ms));
          socket.once('disconnect', () => clearTimeout(t));
          next();
        } catch (err) {
          const e = new Error(err instanceof AppError ? err.code : 'AUTH_FAILED') as Error & { data?: unknown };
          e.data = { code: e.message };
          next(e);
        }
      })();
    });
  }

  /** 사용자 채널(초대 알림 등) 가입 + 전역 온라인 표시 */
  async handleConnection(client: Socket) {
    if (!client.data.userId) return;
    await client.join(userChannel(client.data.userId));
    this.realtime.userConnected(client.data.userId);
  }

  handleDisconnect(client: Socket) {
    if (client.data.userId) this.realtime.userDisconnected(client.data.userId);
    const rooms: Set<string> | undefined = client.data.rooms;
    for (const roomId of rooms ?? []) {
      this.realtime.leave(roomId, client.data.userId);
      void this.rooms.broadcast(roomId); // 접속 상태 갱신
    }
  }

  @SubscribeMessage('room:subscribe')
  subscribe(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => {
      const { roomId } = parseInput(RoomRef, body);
      const room = await this.rooms.get(roomId, c.data.userId);
      if (!c.data.rooms.has(roomId)) {
        await c.join(channel(roomId));
        c.data.rooms.add(roomId);
        this.realtime.join(roomId, c.data.userId);
        void this.rooms.broadcast(roomId);
      }
      const match = room.status === 'PLAYING' && room.matchId ? await this.matches.get(room.matchId, c.data.userId) : null;
      const messages = (await this.chat.recent(roomId)).items;
      return { room: await this.rooms.get(roomId, c.data.userId), match, messages };
    });
  }

  @SubscribeMessage('room:unsubscribe')
  unsubscribe(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => {
      const { roomId } = parseInput(RoomRef, body);
      if (c.data.rooms.delete(roomId)) {
        await c.leave(channel(roomId));
        this.realtime.leave(roomId, c.data.userId);
        void this.rooms.broadcast(roomId);
      }
      return { roomId };
    });
  }

  @SubscribeMessage('room:ready')
  ready(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => {
      const { roomId } = parseInput(RoomRef, body);
      return this.rooms.setReady(roomId, c.data.userId, parseInput(ReadyInput, body).ready);
    });
  }

  @SubscribeMessage('room:start')
  start(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => (await this.rooms.start(parseInput(RoomRef, body).roomId, c.data.userId)).match);
  }

  /** 채팅: {roomId, clientMessageId, text} → ACK 저장된 Message, 방 전체에 chat:message */
  @SubscribeMessage('chat:send')
  sendChat(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => {
      const { roomId } = parseInput(RoomRef, body);
      return this.chat.send(roomId, c.data.userId, parseInput(SendMessageInput, body));
    });
  }

  @SubscribeMessage('match:roll')
  roll(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.command(c, body, 'ROLL');
  }

  @SubscribeMessage('match:hold')
  hold(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.command(c, body, 'HOLD');
  }

  @SubscribeMessage('match:score')
  score(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.command(c, body, 'SCORE');
  }

  @SubscribeMessage('match:briefed')
  briefedEvt(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => this.matches.briefed(parseInput(MatchRef, body).matchId, c.data.userId));
  }

  @SubscribeMessage('match:mode')
  mode(@ConnectedSocket() c: Socket, @MessageBody() body: unknown) {
    return this.ack(async () => {
      const { matchId } = parseInput(MatchRef, body);
      return this.matches.setMode(matchId, c.data.userId, parseInput(PlayModeInput, body).mode);
    });
  }

  private command(c: Socket, body: unknown, type: 'ROLL' | 'HOLD' | 'SCORE') {
    return this.ack(async () => {
      const { matchId } = parseInput(MatchRef, body);
      const input = parseInput(MatchCommandInput, { ...(body as object), type });
      return this.matches.command(matchId, c.data.userId, input);
    });
  }

  private async ack(fn: () => Promise<unknown>): Promise<Ack> {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
      this.logger.error(`소켓 처리 오류 — ${errorSummary(err)}`);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' } };
    }
  }
}
