import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error.js';
import { errorSummary } from './util.js';

/** AppError 가 아닌 프레임워크 예외는 원문 메시지(파서 오류·경로 등)를 노출하지 않고 고정 코드·문구로 응답한다. */
const GENERIC: Record<number, [string, string]> = {
  400: ['MALFORMED_REQUEST', '요청 형식이 올바르지 않습니다.'], // 잘못된 JSON(SyntaxError)·URI 인코딩 오류
  401: ['AUTH_REQUIRED', '로그인이 필요합니다.'],
  403: ['FORBIDDEN', '권한이 없습니다.'],
  404: ['NOT_FOUND', '요청한 경로를 찾을 수 없습니다.'],
  405: ['METHOD_NOT_ALLOWED', '허용되지 않은 메서드입니다.'],
  409: ['CONFLICT', '요청이 현재 상태와 충돌합니다.'],
  413: ['PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', '지원하지 않는 형식입니다.'],
  429: ['RATE_LIMITED', '요청이 너무 많습니다.'],
};

/** 모든 오류를 { error: { code, message, requestId, details? } } 로 통일. 5xx 는 내부 정보를 숨긴다. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (res.locals.requestId as string | undefined) ?? '';

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '서버 오류가 발생했습니다.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
      for (const [k, v] of Object.entries(exception.headers ?? {})) res.setHeader(k, v);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      [code, message] = GENERIC[status] ?? (status >= 500 ? [code, message] : ['BAD_REQUEST', '잘못된 요청입니다.']);
    } else if (isBodyParserError(exception)) {
      // body-parser 의 413(크기 초과) 등 Nest 가 감싸지 않는 오류
      status = exception.status;
      [code, message] = GENERIC[status] ?? ['BAD_REQUEST', '잘못된 요청입니다.'];
    }

    if (status >= 500) this.logger.error(`${req.method} ${req.path} rid=${requestId} — ${errorSummary(exception)}`);
    res.status(status).json({ error: { code, message, requestId, ...(details !== undefined ? { details } : {}) } });
  }
}

function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return !!e && typeof e === 'object' && 'type' in e && 'status' in e && typeof (e as { status: unknown }).status === 'number';
}
