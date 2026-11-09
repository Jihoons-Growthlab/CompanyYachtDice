import type { z } from 'zod';
import { Errors } from './app-error.js';

/** zod 검증. 실패 시 400 VALIDATION_FAILED + 필드별 사유(입력값 자체는 되돌려주지 않음). */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw Errors.validation(
      result.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return result.data;
}
