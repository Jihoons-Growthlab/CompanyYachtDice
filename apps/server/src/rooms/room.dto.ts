import { z } from 'zod';
import { RoomPolicy } from '../game/game.policy.js';

const P = RoomPolicy;
export const CreateRoomInput = z.object({
  name: z.string().trim().min(1).max(40).describe('방 이름 1–40자'),
  capacity: z.number().int().min(P.minCapacity).max(P.maxCapacity).default(P.defaultCapacity).describe('정원 2–6'),
  turnTimeLimitSec: z.number().int().optional().describe('턴 제한시간(초): 60/120/180/240/300 (테스트 모드 3–300). 기본 180'),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC').describe('PRIVATE 면 서버가 6자리 입장 코드를 만든다'),
  botsAllowed: z.boolean().default(true).describe('방장이 봇을 추가할 수 있는지'),
});
export const JoinInput = z.object({ code: z.string().trim().max(16).optional().describe('비공개 방 입장 코드') });
export const InviteInput = z.object({ targetUserId: z.uuid() });
export const UpdateRoomInput = z
  .object({
    capacity: z.number().int().min(P.minCapacity).max(P.maxCapacity).optional(),
    turnTimeLimitSec: z.number().int().optional(),
  })
  .refine((v) => v.capacity !== undefined || v.turnTimeLimitSec !== undefined, '변경할 값이 없습니다.');
export const ReadyInput = z.object({ ready: z.boolean() });

export const StartBlocker = z.enum(['NOT_WAITING', 'NOT_ENOUGH_PLAYERS', 'NOT_ALL_READY', 'OVER_CAPACITY']);
export const RoomMemberSchema = z.object({
  userId: z.uuid(),
  nickname: z.string().nullable(),
  departmentLabel: z.string().nullable(),
  rankLabel: z.string().describe('직급(완주 수 기반 계산값)'),
  ready: z.boolean(),
  isOwner: z.boolean(),
  isBot: z.boolean(),
  online: z.boolean().describe('실시간 연결 여부'),
  joinedAt: z.string(),
});
export const RoomSnapshotSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['WAITING', 'PLAYING', 'CLOSED']),
  capacity: z.number().int(),
  turnTimeLimitSec: z.number().int(),
  ownerId: z.uuid(),
  isTest: z.boolean(),
  isPrivate: z.boolean(),
  joinCode: z.string().nullable().describe('비공개 방 입장 코드(참여자에게만 보이는 스냅샷)'),
  botsAllowed: z.boolean(),
  matchId: z.uuid().nullable().describe('진행 중이거나 마지막으로 끝난 게임'),
  members: z.array(RoomMemberSchema),
  start: z.object({ canStart: z.boolean(), blockers: z.array(StartBlocker), minPlayers: z.number().int() }),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export const RoomListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  capacity: z.number().int(),
  count: z.number().int(),
  turnTimeLimitSec: z.number().int(),
  ownerNickname: z.string().nullable(),
  isTest: z.boolean(),
  status: z.enum(['WAITING', 'PLAYING']),
  isPrivate: z.boolean(),
  botsAllowed: z.boolean(),
});
