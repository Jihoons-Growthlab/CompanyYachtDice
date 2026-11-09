import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';
import { errorSummary, withTimeout } from '../common/util.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  constructor(@Inject(ENV) private readonly env: Env) {
    const adapter = new PrismaPg({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      application_name: 'officeyacht-api',
    });
    super({ adapter });
  }

  /** 시작 시 1회 연결을 시도하되 실패해도 프로세스는 띄운다(/health/ready 가 503 으로 노출). */
  async onModuleInit() {
    try {
      await withTimeout(this.$queryRaw`SELECT 1`, this.env.DB_CONNECT_TIMEOUT_MS + 500, 'postgres connect');
      this.logger.log('PostgreSQL 연결 확인');
    } catch (err) {
      this.logger.warn(`PostgreSQL 초기 연결 실패 — ${errorSummary(err)}`);
    }
  }

  async ping(timeoutMs: number) {
    await withTimeout(this.$queryRaw`SELECT 1`, timeoutMs, 'postgres ping');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('PostgreSQL 연결 종료');
  }
}
