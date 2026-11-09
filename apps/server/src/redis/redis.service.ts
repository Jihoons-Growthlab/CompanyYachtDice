import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { errorSummary, withTimeout } from '../common/util.js';

/**
 * 단일 Redis 연결. 인증 state·요청 제한 등 정확성이 필요한 용도에서는
 * 연결 장애 시 오류를 그대로 올려 요청을 거부해야 한다(우회 허용 금지).
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  readonly client: Redis;
  private lastErrorLogAt = 0;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      keyPrefix: env.REDIS_KEY_PREFIX,
      connectionName: 'officeyacht-api',
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
      // 연결이 끊긴 동안 명령을 쌓지 않고 즉시 실패시킨다.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      // 재연결은 계속 시도하되 최대 5초 간격.
      retryStrategy: (times) => Math.min(times * 200, 5000),
      reconnectOnError: (err) => err.message.startsWith('READONLY'),
    });
    this.client.on('error', (err) => {
      // 장애 동안 로그 폭주 방지: 10초에 한 번만 기록
      const now = Date.now();
      if (now - this.lastErrorLogAt > 10_000) {
        this.lastErrorLogAt = now;
        this.logger.warn(`Redis 오류 — ${errorSummary(err)}`);
      }
    });
    this.client.on('ready', () => this.logger.log('Redis 연결 준비'));
  }

  async onModuleInit() {
    try {
      await withTimeout(this.client.connect(), this.env.REDIS_CONNECT_TIMEOUT_MS + 500, 'redis connect');
    } catch (err) {
      // 재연결은 ioredis 가 백그라운드에서 계속한다.
      this.logger.warn(`Redis 초기 연결 실패 — ${errorSummary(err)}`);
    }
  }

  async ping(timeoutMs: number) {
    const res = await withTimeout(this.client.ping(), timeoutMs, 'redis ping');
    if (res !== 'PONG') throw new Error(`unexpected PING reply`);
  }

  async onModuleDestroy() {
    try {
      if (this.client.status === 'ready') await withTimeout(this.client.quit(), 2000, 'redis quit');
      else this.client.disconnect();
    } catch {
      this.client.disconnect();
    }
    this.logger.log('Redis 연결 종료');
  }
}
