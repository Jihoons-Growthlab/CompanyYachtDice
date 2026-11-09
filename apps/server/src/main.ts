import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { loadEnv } from './config/env.js';
import { errorSummary } from './common/util.js';
import { LifecycleService } from './health/lifecycle.service.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await createApp(env);
  const logger = new Logger('Bootstrap');

  await app.listen(env.PORT, env.HOST);
  logger.log(`API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);

  // SIGTERM/SIGINT: draining(ready=503) → drain 대기 → HTTP 수신 종료·진행 중 요청 완료 → Prisma/Redis 해제.
  const lifecycle = app.get(LifecycleService);
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} 수신 — 종료 시작`);
    lifecycle.startDraining();
    const force = setTimeout(() => {
      logger.error(`종료 제한 시간(${env.SHUTDOWN_TIMEOUT_MS}ms) 초과 — 강제 종료`);
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    force.unref();
    if (env.SHUTDOWN_DRAIN_MS > 0) await new Promise((r) => setTimeout(r, env.SHUTDOWN_DRAIN_MS));
    try {
      // Nest 의 app.close() 는 모듈 destroy 훅을 HTTP 종료보다 먼저 호출한다.
      // 진행 중 요청이 닫힌 Prisma/Redis 를 만나지 않도록 HTTP 수신을 먼저 끝내고 요청 완료를 기다린다.
      const server = app.getHttpServer();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      logger.log('HTTP 수신 종료·진행 중 요청 완료');
      await app.close();
      logger.log('정상 종료');
      process.exitCode = 0;
    } catch (err) {
      logger.error(`종료 중 오류 — ${errorSummary(err)}`);
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').fatal(`시작 실패 — ${errorSummary(err)}`);
  process.exit(1);
});
