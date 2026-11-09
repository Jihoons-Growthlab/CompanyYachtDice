import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { parseInput } from '../common/validation.js';
import { ApiData, ApiErrors, ApiJsonBody } from '../common/openapi.js';
import { PatchPreferencesInput, PREF_DEFAULTS, PreferencesSchema, type Preferences } from './preferences.dto.js';

type Row = Omit<Preferences, 'saved' | 'updatedAt'> & { updatedAt: Date };

/** 개인 환경 설정. 인증된 본인 설정만 조회·수정한다(경로에 사용자 ID 없음 → 다른 계정 접근 불가). */
@ApiTags('회원')
@ApiBearerAuth('access')
@ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED · TOKEN_INVALID'])
@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '내 환경 설정', description: '저장된 적이 없으면 기본값과 saved=false 를 돌려준다.' })
  @ApiData(200, '설정', PreferencesSchema, { ...PREF_DEFAULTS, saved: false, updatedAt: null })
  async get(@CurrentUser() u: AuthUser) {
    const row = await this.prisma.userPreference.findUnique({ where: { userId: u.userId } });
    return { data: toDto(row) };
  }

  @Patch()
  @ApiOperation({ summary: '내 환경 설정 변경(부분)', description: '보낸 항목만 바꾼다. 처음이면 기본값에 덮어써 생성. 마지막 저장이 우선(같은 계정 여러 브라우저).' })
  @ApiJsonBody(PatchPreferencesInput, { uiMode: 'CMD', soundVolume: 40 })
  @ApiData(200, '저장된 설정', PreferencesSchema)
  @ApiErrors([400, 'VALIDATION_FAILED'])
  async patch(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parseInput(PatchPreferencesInput, body);
    const row = await this.prisma.userPreference.upsert({
      where: { userId: u.userId },
      create: { userId: u.userId, ...input },
      update: input,
    });
    return { data: toDto(row) };
  }
}

function toDto(row: Row | null): Preferences {
  if (!row) return { ...PREF_DEFAULTS, saved: false, updatedAt: null };
  const { updatedAt, ...rest } = row as Row & { userId?: string };
  delete (rest as { userId?: string }).userId;
  return { ...(rest as Omit<Row, 'updatedAt'>), saved: true, updatedAt: updatedAt.toISOString() };
}
