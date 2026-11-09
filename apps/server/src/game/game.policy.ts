/**
 * 방·게임 정책 값. 명세가 확정되지 않은 수치는 여기서만 바꾼다(docs/tasks/GAME-ROOM-001.md §7).
 * DB CHECK 는 더 넓은 범위(정원 2–6, 제한시간 3–60초)로 최후 방어만 한다.
 */
export const RoomPolicy = {
  /** 2026-11-09 사용자 요청으로 최대 6명으로 통일(기존 명세 2–4) */
  minCapacity: 2,
  maxCapacity: 6,
  defaultCapacity: 4,
  /** 일반 모드 시작 최소 인원(방장 포함) */
  minPlayersToStart: 2,
  /** 2026-11-09 변경: 1–5분(기존 10/15/30/60초). 기본 3분 */
  turnTimeLimitOptions: [60, 120, 180, 240, 300] as readonly number[],
  defaultTurnTimeLimitSec: 180,
  /** 테스트 모드에서만 허용하는 단축 범위(3초–5분) */
  testTurnTimeLimitMinSec: 3,
  maxTurnTimeLimitSec: 300,
  listLimit: 50,
  /** 동시에 들어갈 수 있는 봇 수(봇 계정 풀 크기) */
  maxBots: 5,
  /** 비공개 방 입장 코드: 혼동 문자(0/O, 1/I/L) 제외 */
  joinCodeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  joinCodeLength: 6,
} as const;

export const InvitePolicy = {
  /** 초대 유효 시간(분). 명세 미정 → 초안 */
  ttlMinutes: 10,
  searchLimit: 10,
} as const;

/** chat.md: 1–300자, 사용자별 10초 5건, 최근 50개, 보관 30일(초안) */
export const ChatPolicy = {
  maxChars: 300,
  maxLines: 10,
  rateLimit: { limit: 5, windowSec: 10 },
  historyLimit: 50,
  retentionDays: 30,
  cleanupIntervalMs: 60 * 60 * 1000,
} as const;

export const GamePolicy = {
  /** 수동 플레이어가 연속으로 시간 초과하면 자리 비움(AWAY, 서버 오토 플레이)으로 전환하는 횟수 */
  timeoutsBeforeAway: 2,
  /** 시간 초과 처리: 굴림이 없었다면 1회 굴리고 남은 칸 중 최고점 칸 확정(yacht.md 초안, Q3 미확정) */
  timeoutAction: 'ROLL_ONCE_THEN_BEST' as const,
  /** AWAY 플레이어가 직접 명령을 보내면 즉시 MANUAL 로 복귀(Q5 미확정 → 가장 단순한 규칙) */
  returnToManualOnInput: true,
  /**
   * 시작 안내 단계: PL 이 시작하면 모든 사람 참여자가 규칙 안내를 확인·건너뛸 때까지 첫 턴 타이머를 멈춘다.
   * 봇·자리 비움은 자동 확인. 응답이 없으면 BRIEFING_TIMEOUT_SEC(기본 120초) 후 그대로 시작한다.
   */
  briefingTimeoutSecDefault: 120,
} as const;

/** 직급: organization.md 초안(완주 0회 사원, 5회 주임, 20회 대리). 직급 마스터 도입 전까지 계산값. */
export function rankLabel(completedMatches: number, kind: 'HUMAN' | 'DEV' | 'BOT'): string {
  if (kind === 'BOT') return '가상 사원';
  if (completedMatches >= 20) return '대리';
  if (completedMatches >= 5) return '주임';
  return '사원';
}
