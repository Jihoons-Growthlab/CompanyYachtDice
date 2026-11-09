import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiData, ApiErrors, ApiJsonBody } from '../common/openapi.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Errors } from '../common/app-error.js';
import { parseInput } from '../common/validation.js';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { MeSchema, ProfileInput, toMe } from './user.dto.js';

const meExample = { id: '019a…', email: 'me@example.com', nickname: '김사원', departmentLabel: '기획', profileCompleted: true, kind: 'HUMAN', createdAt: '2026-11-09T10:00:00.000Z' };

@ApiTags('회원')
@ApiBearerAuth('access')
@ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED · TOKEN_INVALID'])
@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '내 정보' })
  @ApiData(200, '사용자', MeSchema, meExample)
  async me(@CurrentUser() auth: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId }, include: { localCredential: true } });
    if (!user) throw Errors.userNotFound();
    return { data: toMe(user) };
  }

  /** 최초 인사 등록 및 수정. 최초 저장 시 profileCompletedAt 기록. */
  @Put('profile')
  @ApiOperation({ summary: '인사 등록·수정', description: '최초 저장 시 profileCompleted=true. 사원명 1–24자, 부서 1–30자.' })
  @ApiJsonBody(ProfileInput, { nickname: '김사원', departmentLabel: '기획' })
  @ApiData(200, '갱신된 사용자', MeSchema, meExample)
  @ApiErrors([400, 'VALIDATION_FAILED'])
  async updateProfile(@CurrentUser() auth: AuthUser, @Body() body: unknown) {
    const input = parseInput(ProfileInput, body);
    const current = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { profileCompletedAt: true } });
    if (!current) throw Errors.userNotFound();
    const user = await this.prisma.user.update({
      where: { id: auth.userId },
      data: { ...input, profileCompletedAt: current.profileCompletedAt ?? new Date() },
      include: { localCredential: true },
    });
    return { data: toMe(user) };
  }
}
