import { HttpException } from '@nestjs/common';

/** API 오류. 응답 형식: { error: { code, message, requestId, details? } } (docs/contracts/rest.md) */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  validation: (details: unknown) => new AppError(400, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', details),
  authRequired: () =>
    new AppError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.', undefined, { 'WWW-Authenticate': 'Bearer' }),
  tokenExpired: () =>
    new AppError(401, 'TOKEN_EXPIRED', '인증이 만료되었습니다.', undefined, {
      'WWW-Authenticate': 'Bearer error="invalid_token", error_description="expired"',
    }),
  tokenInvalid: () =>
    new AppError(401, 'TOKEN_INVALID', '유효하지 않은 인증입니다.', undefined, {
      'WWW-Authenticate': 'Bearer error="invalid_token"',
    }),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.'),
  refreshMissing: () => new AppError(401, 'REFRESH_TOKEN_MISSING', '다시 로그인해 주세요.'),
  refreshInvalid: () => new AppError(401, 'REFRESH_TOKEN_INVALID', '다시 로그인해 주세요.'),
  refreshReused: () => new AppError(401, 'REFRESH_TOKEN_REUSED', '보안을 위해 모든 기기에서 로그아웃되었습니다. 다시 로그인해 주세요.'),
  sessionExpired: () => new AppError(401, 'SESSION_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.'),
  sessionRevoked: () => new AppError(401, 'SESSION_REVOKED', '로그아웃된 세션입니다. 다시 로그인해 주세요.'),
  originRejected: () => new AppError(403, 'ORIGIN_REJECTED', '허용되지 않은 요청 출처입니다.'),
  emailTaken: () => new AppError(409, 'EMAIL_TAKEN', '이미 가입된 이메일입니다.'),
  userNotFound: () => new AppError(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.'),
  rateLimited: (retryAfterSec: number) =>
    new AppError(429, 'RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', { retryAfterSec }, {
      'Retry-After': String(retryAfterSec),
    }),
  profileRequired: () => new AppError(403, 'PROFILE_REQUIRED', '인사 등록(사원명·부서)을 먼저 완료해 주세요.'),
  roomNotFound: () => new AppError(404, 'ROOM_NOT_FOUND', '게임방을 찾을 수 없습니다.'),
  notRoomMember: () => new AppError(403, 'NOT_ROOM_MEMBER', '이 게임방의 참여자가 아닙니다.'),
  notRoomOwner: () => new AppError(403, 'NOT_ROOM_OWNER', '방장(PL)만 할 수 있습니다.'),
  roomFull: () => new AppError(409, 'ROOM_FULL', '정원이 가득 찼습니다.'),
  roomNotWaiting: () => new AppError(409, 'ROOM_NOT_WAITING', '대기 중인 방에서만 할 수 있습니다.'),
  capacityBelowMembers: () => new AppError(409, 'CAPACITY_BELOW_MEMBERS', '현재 인원보다 적은 정원으로 바꿀 수 없습니다.'),
  cannotStart: (blockers: string[]) => new AppError(409, 'START_CONDITIONS_UNMET', '게임 시작 조건을 충족하지 않았습니다.', { blockers }),
  matchNotFound: () => new AppError(404, 'MATCH_NOT_FOUND', '게임을 찾을 수 없습니다.'),
  notMatchPlayer: () => new AppError(403, 'NOT_MATCH_PLAYER', '이 게임의 참여자가 아닙니다.'),
  staleVersion: (currentVersion: number) =>
    new AppError(409, 'STALE_VERSION', '게임 상태가 바뀌었습니다. 최신 상태로 다시 시도해 주세요.', { currentVersion }),
  idempotencyConflict: () => new AppError(409, 'IDEMPOTENCY_CONFLICT', '같은 명령 ID로 다른 요청을 보냈습니다.'),
  gameRule: (code: string) => new AppError(409, code, GAME_RULE_MESSAGES[code] ?? '허용되지 않는 게임 명령입니다.'),
  joinCodeRequired: () => new AppError(403, 'JOIN_CODE_REQUIRED', '비공개 평가실입니다. 입장 코드를 입력해 주세요.'),
  joinCodeInvalid: () => new AppError(403, 'JOIN_CODE_INVALID', '입장 코드가 올바르지 않습니다.'),
  botsNotAllowed: () => new AppError(409, 'BOTS_NOT_ALLOWED', '봇 참여를 허용하지 않은 평가실입니다.'),
  inviteNotFound: () => new AppError(404, 'INVITE_NOT_FOUND', '초대를 찾을 수 없습니다.'),
  inviteNotPending: () => new AppError(409, 'INVITE_NOT_PENDING', '이미 처리된 초대입니다.'),
  inviteExpired: () => new AppError(409, 'INVITE_EXPIRED', '만료된 초대입니다.'),
  inviteInvalidTarget: () => new AppError(409, 'INVITE_INVALID_TARGET', '초대할 수 없는 사용자입니다.'),
  testModeOnly: () => new AppError(403, 'TEST_MODE_ONLY', '개발 테스트 모드에서만 허용됩니다.'),
  dependencyUnavailable: () =>
    new AppError(503, 'SERVICE_UNAVAILABLE', '일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.'),
};

const GAME_RULE_MESSAGES: Record<string, string> = {
  NOT_YOUR_TURN: '내 차례가 아닙니다.',
  ROLL_LIMIT: '이번 턴의 굴림 횟수(3회)를 모두 사용했습니다.',
  ALL_HELD: '모든 주사위를 보관해 굴릴 수 없습니다.',
  NO_ROLL_YET: '먼저 주사위를 굴려 주세요.',
  INVALID_HOLD: '보관 정보가 올바르지 않습니다.',
  INVALID_CATEGORY: '없는 점수 항목입니다.',
  CATEGORY_FILLED: '이미 기록한 항목입니다.',
  MATCH_FINISHED: '이미 끝난 게임입니다.',
  INVALID_COMMAND: '알 수 없는 명령입니다.',
  BRIEFING_IN_PROGRESS: '참여자들이 게임 안내를 확인하는 중입니다. 모두 확인하면 첫 턴이 시작됩니다.',
};
