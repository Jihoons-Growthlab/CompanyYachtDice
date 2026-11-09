import { z } from 'zod';

type UserRow = {
  id: string;
  nickname: string | null;
  departmentLabel: string | null;
  profileCompletedAt: Date | null;
  createdAt: Date;
  kind: 'HUMAN' | 'DEV' | 'BOT';
  localCredential?: { email: string } | null;
};

export const MeSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable().describe('이메일 계정이 아니면 null(소셜·테스트 계정)'),
  nickname: z.string().nullable(),
  departmentLabel: z.string().nullable(),
  profileCompleted: z.boolean().describe('false 면 인사 등록(PUT /me/profile) 필요'),
  kind: z.enum(['HUMAN', 'DEV', 'BOT']),
  createdAt: z.string(),
});
export type MeDto = z.infer<typeof MeSchema>;

export function toMe(u: UserRow): MeDto {
  return {
    id: u.id,
    email: u.localCredential?.email ?? null,
    nickname: u.nickname,
    departmentLabel: u.departmentLabel,
    profileCompleted: u.profileCompletedAt !== null,
    kind: u.kind,
    createdAt: u.createdAt.toISOString(),
  };
}

// 제어문자 금지, 앞뒤 공백 제거. 길이는 목업 입력 제한(24/30)과 맞춘다(DB 는 40/60).
const label = (max: number) =>
  z
    .string()
    .trim()
    .min(1, '필수 입력입니다.')
    .max(max, `${max}자 이하로 입력해 주세요.`)
    .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s), '사용할 수 없는 문자가 있습니다.');

export const ProfileInput = z.object({
  nickname: label(24),
  departmentLabel: label(30),
});
