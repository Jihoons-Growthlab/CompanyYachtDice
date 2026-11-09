import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { isAllowedOrigin, type Env } from '../config/env.js';

/** HTTP 와 같은 Origin 규칙을 소켓 handshake 에 적용(교차 사이트 WebSocket 하이재킹 방지) */
export class SocketIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly env: Env) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...(options ?? {}),
      path: '/socket.io',
      serveClient: false,
      // 끊긴 연결을 빨리 감지(기본 25s+20s → 10s+5s): 접속 상태·재연결 표시용
      pingInterval: 10_000,
      pingTimeout: 5_000,
      cors: { origin: false },
      allowRequest: (req, cb) => cb(null, isAllowedOrigin(this.env, req.headers.origin)),
    } as ServerOptions);
  }
}
