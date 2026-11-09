import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { Errors } from '../common/app-error.js';
import { errorSummary } from '../common/util.js';

export type Window = { limit: number; windowSec: number };

/**
 * 고정 윈도 카운터(Redis INCR + 최초 EXPIRE, 원자적 MULTI).
 * Redis 장애 시 **거부(fail closed)** 한다 — 인증·보호된 쓰기의 우회 허용 금지(docs/infrastructure.md).
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger('RateLimit');
  constructor(private readonly redis: RedisService) {}

  /** 카운트를 1 증가시키고 한도를 넘으면 429 */
  async consume(key: string, w: Window): Promise<void> {
    const [count, ttl] = await this.run(async () => {
      const res = await this.redis.client.multi().incr(`rl:${key}`).expire(`rl:${key}`, w.windowSec, 'NX').ttl(`rl:${key}`).exec();
      if (!res || res.some(([e]) => e)) throw new Error('MULTI failed');
      return [Number(res[0]![1]), Number(res[2]![1])] as const;
    });
    if (count > w.limit) throw Errors.rateLimited(Math.max(1, ttl));
  }

  /** 증가 없이 현재 한도 초과 여부만 확인(실패 횟수 기반 제한용) */
  async assertBelow(key: string, w: Window): Promise<void> {
    const [count, ttl] = await this.run(async () => {
      const res = await this.redis.client.multi().get(`rl:${key}`).ttl(`rl:${key}`).exec();
      if (!res || res.some(([e]) => e)) throw new Error('MULTI failed');
      return [Number(res[0]![1] ?? 0), Number(res[1]![1])] as const;
    });
    if (count >= w.limit) throw Errors.rateLimited(Math.max(1, ttl));
  }

  async reset(key: string): Promise<void> {
    await this.run(() => this.redis.client.del(`rl:${key}`));
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`rate limit 저장소 오류 — 요청 거부: ${errorSummary(err)}`);
      throw Errors.dependencyUnavailable();
    }
  }
}
