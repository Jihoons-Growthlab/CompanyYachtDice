import { Controller, Get, HttpStatus, Inject, Logger, Res } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LifecycleService } from './lifecycle.service.js';
import { errorCode, errorSummary } from '../common/util.js';

type Check = { status: 'up' | 'down'; latencyMs: number; error?: string };

@ApiTags('상태')
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Health');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly lifecycle: LifecycleService,
  ) {}

  /** 프로세스 생존. 의존성을 검사하지 않는다(장애 시 재시작 폭주 방지). */
  @Get('live')
  @ApiOperation({ summary: '프로세스 생존' })
  live() {
    return { status: 'ok', uptimeS: Math.round(process.uptime()) };
  }

  /** PG 쿼리와 Redis PING 을 제한 시간 안에 병렬 확인. 하나라도 실패하거나 종료 중이면 503. */
  @Get('ready')
  @ApiOperation({ summary: '준비 상태(PG·Redis)', description: '하나라도 실패하거나 종료 중이면 503' })
  @ApiResponse({ status: 503, description: '의존성 장애 또는 종료 중' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const t = this.env.HEALTH_CHECK_TIMEOUT_MS;
    const [postgres, redis] = await Promise.all([
      this.run('postgres', () => this.prisma.ping(t)),
      this.run('redis', () => this.redis.ping(t)),
    ]);
    const draining = this.lifecycle.isDraining;
    const ok = !draining && postgres.status === 'up' && redis.status === 'up';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    res.setHeader('Cache-Control', 'no-store');
    return { status: ok ? 'ok' : 'error', ...(draining ? { draining: true } : {}), checks: { postgres, redis } };
  }

  private async run(name: string, fn: () => Promise<void>): Promise<Check> {
    const start = performance.now();
    try {
      await fn();
      return { status: 'up', latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      this.logger.warn(`${name} 준비 상태 실패 — ${errorSummary(err)}`);
      // 응답에는 오류 코드만 담는다(호스트·메시지·스택 비노출).
      return { status: 'down', latencyMs: Math.round(performance.now() - start), error: errorCode(err) };
    }
  }
}
