import { z } from 'zod';

export const PREF_DEFAULTS = {
  uiMode: 'EXCEL',
  uiScale: 'NORMAL',
  effectSpeed: 'NORMAL',
  reducedMotion: false,
  diceAnimation: true,
  turnNotification: true,
  soundEnabled: false,
  soundVolume: 60,
  ribbonCollapsed: false,
} as const;

const fields = {
  uiMode: z.enum(['EXCEL', 'CMD']).describe('UI 모드'),
  uiScale: z.enum(['SMALL', 'NORMAL', 'LARGE']).describe('UI 크기'),
  effectSpeed: z.enum(['FAST', 'NORMAL', 'SLOW']).describe('개인 화면 연출 속도(주사위 애니메이션·알림 표시 시간). 서버 봇 진행 속도와 무관'),
  reducedMotion: z.boolean().describe('애니메이션 축소'),
  diceAnimation: z.boolean().describe('주사위 굴림 애니메이션'),
  turnNotification: z.boolean().describe('내 턴 시작 알림'),
  soundEnabled: z.boolean().describe('효과음'),
  soundVolume: z.number().int().min(0).max(100).describe('효과음 음량 0–100'),
  ribbonCollapsed: z.boolean().describe('게임 중 리본 접기'),
};

/** 부분 수정. 알 수 없는 키는 거부(strict). 최소 1개 */
export const PatchPreferencesInput = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof fields]: z.ZodOptional<(typeof fields)[K]> })
  .strict()
  .refine((o) => Object.keys(o).length > 0, '변경할 설정이 없습니다.');

export const PreferencesSchema = z.object({
  ...fields,
  saved: z.boolean().describe('false 면 아직 서버에 저장된 적 없음(기본값 응답)'),
  updatedAt: z.string().nullable(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
