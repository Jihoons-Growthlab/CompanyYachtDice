import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * 소켓 서버 참조와 접속 상태(presence). 단일 인스턴스 기준 메모리 보관.
 * 다중 인스턴스에서는 Socket.IO Redis adapter + presence 를 Redis TTL 키로 옮긴다(docs/architecture.md).
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private server: Server | null = null;
  /** roomId → userId → 구독 소켓 수 */
  private readonly presence = new Map<string, Map<string, number>>();
  /** userId → 연결 소켓 수(전역 온라인) */
  private readonly connected = new Map<string, number>();
  private lobbyTimer: NodeJS.Timeout | null = null;

  attach(server: Server) {
    this.server = server;
  }

  emitToRoom(roomId: string, event: string, payload: unknown) {
    this.server?.to(channel(roomId)).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(userChannel(userId)).emit(event, payload);
  }

  /** 방 목록 변경 알림(짧은 시간의 연속 변경은 한 번으로 합침). 클라이언트는 GET /rooms 로 다시 읽는다. */
  lobbyChanged() {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      this.server?.emit('lobby:changed', {});
    }, 150);
  }

  userConnected(userId: string) {
    this.connected.set(userId, (this.connected.get(userId) ?? 0) + 1);
  }

  userDisconnected(userId: string) {
    const n = (this.connected.get(userId) ?? 0) - 1;
    if (n > 0) this.connected.set(userId, n);
    else this.connected.delete(userId);
  }

  isOnline(userId: string) {
    return this.connected.has(userId);
  }

  join(roomId: string, userId: string) {
    const m = this.presence.get(roomId) ?? new Map<string, number>();
    m.set(userId, (m.get(userId) ?? 0) + 1);
    this.presence.set(roomId, m);
  }

  leave(roomId: string, userId: string) {
    const m = this.presence.get(roomId);
    if (!m) return;
    const n = (m.get(userId) ?? 0) - 1;
    if (n > 0) m.set(userId, n);
    else m.delete(userId);
    if (!m.size) this.presence.delete(roomId);
  }

  onlineUsers(roomId: string): Set<string> {
    return new Set(this.presence.get(roomId)?.keys() ?? []);
  }

  onModuleDestroy() {
    this.stop();
  }

  stop() {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.lobbyTimer = null;
  }
}

export const channel = (roomId: string) => `room:${roomId}`;
export const userChannel = (userId: string) => `user:${userId}`;
