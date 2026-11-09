import { z } from 'zod';
import { AuthPolicy } from './auth.policy.js';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, '이메일이 너무 깁니다.')
  .pipe(z.email('이메일 형식이 올바르지 않습니다.'));

const P = AuthPolicy.password;
const newPassword = z
  .string()
  .refine((s) => [...s].length >= P.minLength, `비밀번호는 ${P.minLength}자 이상이어야 합니다.`)
  .refine((s) => [...s].length <= P.maxLength, `비밀번호는 ${P.maxLength}자 이하여야 합니다.`)
  .refine((s) => s.trim().length > 0, '공백만으로 된 비밀번호는 사용할 수 없습니다.');

export const SignupInput = z.object({ email, password: newPassword });
// 로그인은 형식만 확인(정책 변경 전 가입자도 로그인 가능해야 함). 상한은 해시 DoS 방지.
export const LoginInput = z.object({ email, password: z.string().min(1).max(P.maxLength * 4) });
