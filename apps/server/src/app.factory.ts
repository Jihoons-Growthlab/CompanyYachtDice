import 'reflect-metadata';
import { type LogLevel, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { requestLog } from './common/request-log.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { SocketIoAdapter } from './realtime/socket-io.adapter.js';
import { setupApiDocs } from './docs.js';

const LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/** main.ts 와 테스트가 공유하는 앱 구성. listen 은 호출자가 한다. */
export async function createApp(env: Env, opts: { logger?: LogLevel[] | false } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: opts.logger ?? LEVELS.slice(0, LEVELS.indexOf(env.LOG_LEVEL) + 1),
    bodyParser: false,
  });
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(requestLog);
  app.useBodyParser('json', { limit: '16kb' });
  app.useGlobalFilters(new HttpExceptionFilter());
  // health 는 LB·컨테이너 헬스체크용으로 접두사 없이 유지
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableCors({ origin: env.allowedOrigins, credentials: true });
  app.useWebSocketAdapter(new SocketIoAdapter(app, env));
  if (env.docsEnabled) setupApiDocs(app, env);
  return app;
}
