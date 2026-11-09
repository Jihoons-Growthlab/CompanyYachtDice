import { z } from 'zod';

const CATS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'choice', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yacht'] as const;
const base = {
  commandId: z.uuid().describe('클라이언트가 만든 UUID. 응답이 없으면 같은 값으로 재전송(중복 처리 방지)'),
  expectedVersion: z.number().int().min(0).describe('마지막으로 본 MatchSnapshot.version'),
};
export const MatchCommandInput = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('ROLL') }),
  z.object({ ...base, type: z.literal('HOLD'), held: z.array(z.boolean()).length(5) }),
  z.object({ ...base, type: z.literal('SCORE'), category: z.enum(CATS) }),
]);
export type MatchCommandInput = z.infer<typeof MatchCommandInput>;
export const PlayModeInput = z.object({ mode: z.enum(['MANUAL', 'AUTO']) });

const Scores = z.object(Object.fromEntries(CATS.map((c) => [c, z.number().int().nullable()])) as Record<(typeof CATS)[number], z.ZodNullable<z.ZodNumber>>);
export const MatchSnapshotSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  ruleset: z.string(),
  status: z.enum(['ACTIVE', 'FINISHED', 'ABORTED']),
  phase: z.enum(['BRIEFING', 'PLAYING', 'FINISHED']).describe('BRIEFING: 시작 안내 확인 대기(턴 타이머 정지, 명령 불가)'),
  briefingDeadlineAt: z.string().nullable().describe('안내 대기 기한. 지나면 확인하지 않은 참여자가 있어도 시작'),
  version: z.number().int(),
  round: z.number().int(),
  totalRounds: z.number().int(),
  turnUserId: z.uuid().nullable(),
  turnDeadlineAt: z.string().nullable(),
  turnTimeLimitSec: z.number().int(),
  serverTime: z.string().describe('클라이언트 시계 보정용'),
  dice: z.array(z.number().int()),
  held: z.array(z.boolean()),
  rollCount: z.number().int(),
  maxRolls: z.number().int(),
  previews: z.record(z.string(), z.number().int()).describe('현재 차례 플레이어의 미기록 칸 미리보기'),
  players: z.array(
    z.object({
      userId: z.uuid(),
      nickname: z.string().nullable(),
      isBot: z.boolean(),
      seat: z.number().int(),
      playMode: z.enum(['MANUAL', 'AUTO', 'AWAY']),
      briefed: z.boolean().describe('시작 안내 확인 여부'),
      scores: Scores,
      upper: z.number().int(),
      bonus: z.number().int(),
      total: z.number().int(),
      rank: z.number().int().nullable(),
    }),
  ),
});
export type MatchSnapshot = z.infer<typeof MatchSnapshotSchema>;
