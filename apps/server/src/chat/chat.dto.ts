import { z } from 'zod';
import { ChatPolicy } from '../game/game.policy.js';

/** 텍스트: 앞뒤 공백 제거, 1–300 코드 포인트, 줄바꿈 외 제어문자 금지, 최대 10줄. HTML 은 저장만 하고 클라이언트가 텍스트로 렌더링한다. */
export const SendMessageInput = z.object({
  clientMessageId: z.uuid().describe('클라이언트가 만든 UUID. 재전송해도 한 번만 저장'),
  text: z
    .string()
    .transform((s) => s.replace(/\r\n?/g, '\n').trim())
    .refine((s) => [...s].length >= 1, '메시지를 입력해 주세요.')
    .refine((s) => [...s].length <= ChatPolicy.maxChars, `${ChatPolicy.maxChars}자 이하로 입력해 주세요.`)
    .refine((s) => s.split('\n').length <= ChatPolicy.maxLines, `${ChatPolicy.maxLines}줄 이하로 입력해 주세요.`)
    .refine((s) => !/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/.test(s), '사용할 수 없는 문자가 있습니다.'),
});
export const HistoryQuery = z.object({
  beforeSeq: z.coerce.number().int().min(1).optional(),
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(ChatPolicy.historyLimit).default(ChatPolicy.historyLimit),
});

export const ChatMessageSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  seq: z.number().int().describe('방별 증가 순번(누락 확인·정렬)'),
  kind: z.enum(['TEXT', 'SYSTEM']),
  userId: z.uuid().nullable().describe('서버가 인증 정보로 지정. SYSTEM 은 null'),
  nickname: z.string().nullable(),
  rankLabel: z.string().nullable(),
  text: z.string(),
  clientMessageId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;
