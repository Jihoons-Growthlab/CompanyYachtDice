import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';

const logger = new Logger('HTTP');
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** requestId 부여(신뢰 가능한 형식의 x-request-id 는 승계) + 완료 로그. 쿼리스트링·헤더·본문은 기록하지 않는다. */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const start = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - start);
    const line = `${req.method} ${req.path} ${res.statusCode} ${ms}ms rid=${requestId}`;
    if (req.path.startsWith('/health/') && res.statusCode < 400) logger.debug(line);
    else if (res.statusCode >= 500) logger.warn(line);
    else logger.log(line);
  });
  next();
}
