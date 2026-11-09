-- AlterTable
ALTER TABLE "match_players" ADD COLUMN     "briefed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "briefing_deadline_at" TIMESTAMPTZ(3);

-- 턴 제한시간 단위 변경(10/15/30/60초 → 1–5분). 범위 CHECK 를 3–300초로 넓힌다(3–59초는 테스트 모드 전용, 앱 정책이 제한).
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_turn_time_limit_check";
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_turn_time_limit_check" CHECK ("turn_time_limit_sec" BETWEEN 3 AND 300);
ALTER TABLE "matches" DROP CONSTRAINT "matches_turn_time_limit_check";
ALTER TABLE "matches" ADD CONSTRAINT "matches_turn_time_limit_check" CHECK ("turn_time_limit_sec" BETWEEN 3 AND 300);
-- 호환: 대기 중인 일반 방의 옛 값(10/15/30초)은 새 기본값 3분으로 바꾼다. 진행·종료된 게임(matches)과 테스트 방은 그대로 둔다.
UPDATE "rooms" SET "turn_time_limit_sec" = 180 WHERE "status" = 'WAITING' AND "is_test" = false AND "turn_time_limit_sec" NOT IN (60, 120, 180, 240, 300);
