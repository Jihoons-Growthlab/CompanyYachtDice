export class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
  }
}

/** 제한 시간 안에 끝나지 않으면 TimeoutError 로 거부한다. 타이머는 항상 정리한다. */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 로그용: URL 자격증명·password= 류 값을 가린다. */
export function redact(text: string): string {
  return text
    .replace(/(\w+:\/\/)([^:@/\s]*):([^@/\s]+)@/g, '$1$2:***@')
    .replace(/(password|passwd|pwd|token|secret)=([^&\s]+)/gi, '$1=***');
}

/** 오류에서 외부로 노출해도 되는 짧은 코드만 추출한다. */
export function errorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'UNKNOWN';
  const e = err as { code?: unknown; message?: unknown; name?: unknown; meta?: any };
  // Prisma 드라이버 어댑터 오류: meta.driverAdapterError.cause.kind (예: DatabaseNotReachable)
  const kind = e.meta?.driverAdapterError?.cause?.kind;
  if (typeof kind === 'string') return kind;
  if (typeof e.code === 'string') return e.code;
  // ioredis: enableOfflineQueue=false 상태에서 연결이 없을 때
  if (typeof e.message === 'string' && e.message.includes("Stream isn't writeable")) return 'NOT_CONNECTED';
  return typeof e.name === 'string' ? e.name : 'UNKNOWN';
}

export function errorSummary(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `${errorCode(err)}: ${redact(msg.replace(/\s+/g, ' ').trim()).slice(0, 300)}`;
}

/**
 * ESM 순환 의존(forwardRef) 주입용 타입 래퍼. 데코레이터 메타데이터가 클래스 값을 즉시 참조하지 않게 한다
 * (`Cannot access 'X' before initialization` 방지).
 */
export type Ref<T> = T;
