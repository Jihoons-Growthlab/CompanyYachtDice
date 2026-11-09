import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Swagger 문서는 검증에 쓰는 zod 스키마에서 그대로 만든다(별도 DTO 클래스 없음 → 문서와 검증이 어긋나지 않음).
 */
export function jsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): Record<string, any> {
  const { $schema: _omit, ...rest } = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as Record<string, any>;
  return rest;
}

export const ApiJsonBody = (schema: z.ZodType, example?: unknown) =>
  ApiBody({ schema: { ...jsonSchema(schema), ...(example !== undefined ? { example } : {}) } });

/** 성공 응답 { data: ... } */
export const ApiData = (status: number, description: string, data: z.ZodType | Record<string, any>, example?: unknown) =>
  ApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      properties: { data: data instanceof z.ZodType ? jsonSchema(data, 'output') : data },
      required: ['data'],
      ...(example !== undefined ? { example: { data: example } } : {}),
    },
  });

const ErrorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: {},
      },
      required: ['code', 'message', 'requestId'],
    },
  },
};

/** 오류 응답들: ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED'], [409, 'ROOM_FULL']) */
export const ApiErrors = (...items: [number, string][]) =>
  applyDecorators(
    ...items.map(([status, codes]) =>
      ApiResponse({ status, description: codes, schema: { ...ErrorSchema, example: { error: { code: codes.split(' ')[0], message: '…', requestId: '…' } } } }),
    ),
  );
