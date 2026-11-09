import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import { CurrentUser, Public, RequireOrigin, type AuthUser } from '../auth/decorators.js';
import { meta } from '../auth/auth.controller.js';
import { writeSession } from '../auth/session-cookie.js';
import { parseInput } from '../common/validation.js';
import { ApiErrors, ApiJsonBody } from '../common/openapi.js';
import { RoomPolicy } from '../game/game.policy.js';
import { DEV_SLOTS, DevService } from './dev.service.js';

const Slot = z.number().int().min(1).max(DEV_SLOTS);
const AccountsInput = z.object({
  count: z.number().int().min(1).max(DEV_SLOTS).describe('생성할 테스트 계정 수(1–6)'),
  profiles: z.array(z.object({ nickname: z.string().trim().min(1).max(24).optional(), departmentLabel: z.string().trim().min(1).max(30).optional() })).max(DEV_SLOTS).optional(),
});
const LoginInput = z.object({ slot: Slot });
const TestRoomInput = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  capacity: z.number().int().min(RoomPolicy.minCapacity).max(RoomPolicy.maxCapacity).default(4),
  turnTimeLimitSec: z.number().int().min(RoomPolicy.testTurnTimeLimitMinSec).max(RoomPolicy.maxTurnTimeLimitSec).optional().describe('테스트 모드는 3–300초 허용(단축 테스트)'),
  bots: z.number().int().min(0).max(5).default(0).describe('부족한 인원을 봇으로 채움(자동 준비·자동 진행)'),
  start: z.boolean().default(false).describe('true 면 바로 강제 시작'),
});
const BotsInput = z.object({ count: z.number().int().min(1).max(5) });
const MemberInput = z.object({ slot: Slot, ready: z.boolean().default(true) });
const ResetInput = z.object({ accounts: z.boolean().default(false).describe('true 면 게임 기록이 없는 테스트 계정·봇도 삭제') });
const RoomId = ApiParam({ name: 'id', format: 'uuid' });

/** TEST_MODE=true(로컬 DB, production 아님)일 때만 등록되는 개발 전용 경로. */
@ApiTags('개발 테스트 (TEST_MODE 전용)')
@ApiBearerAuth('access')
@Controller('dev')
export class DevController {
  constructor(private readonly dev: DevService, @Inject(ENV) private readonly env: Env) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: '테스트 모드 상태·테스트 계정 목록', description: '이 경로가 404 면 테스트 모드가 꺼져 있다.' })
  async status() {
    return { data: await this.dev.status() };
  }

  @Public()
  @RequireOrigin()
  @Post('accounts')
  @ApiOperation({ summary: '테스트 계정 1–6개 생성·프로필 지정' })
  @ApiJsonBody(AccountsInput, { count: 3, profiles: [{ nickname: '김PL', departmentLabel: '기획' }] })
  async accounts(@Body() body: unknown) {
    const input = parseInput(AccountsInput, body);
    return { data: { accounts: await this.dev.ensureAccounts(input.count, input.profiles) } };
  }

  @Public()
  @RequireOrigin()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '간편 로그인(테스트 계정)', description: '소셜·비밀번호 없이 테스트 계정 세션 발급. 응답 형식은 /auth/login 과 같다(refresh 쿠키 포함).' })
  @ApiJsonBody(LoginInput, { slot: 1 })
  @ApiErrors([403, 'ORIGIN_REJECTED'])
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return writeSession(res, this.env, await this.dev.login(parseInput(LoginInput, body).slot, meta(req)));
  }

  @Post('rooms')
  @ApiOperation({ summary: '테스트 방 생성(+봇 채우기·강제 시작)' })
  @ApiJsonBody(TestRoomInput, { capacity: 4, bots: 3, turnTimeLimitSec: 60, start: true })
  async room(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return { data: await this.dev.createTestRoom(u.userId, parseInput(TestRoomInput, body)) };
  }

  @Post('rooms/:id/bots')
  @RoomId
  @ApiOperation({ summary: '가상 플레이어(봇) 추가 — 자동 준비' })
  @ApiJsonBody(BotsInput, { count: 2 })
  async bots(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.dev.addBots(id, u.userId, parseInput(BotsInput, body).count) };
  }

  @Post('rooms/:id/members')
  @RoomId
  @ApiOperation({ summary: '다른 테스트 계정을 참여자로 입장(초대 수락 우회)' })
  @ApiJsonBody(MemberInput, { slot: 2, ready: false })
  async member(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseInput(MemberInput, body);
    return { data: await this.dev.addDevMember(id, u.userId, input.slot, input.ready) };
  }

  @Post('rooms/:id/ready-all')
  @HttpCode(200)
  @RoomId
  @ApiOperation({ summary: '전체 준비' })
  async readyAll(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.dev.readyAll(id, u.userId) };
  }

  @Post('rooms/:id/force-start')
  @HttpCode(200)
  @RoomId
  @ApiOperation({ summary: '강제 시작(개발 전용)', description: '준비·최소 인원 조건 생략. 혼자 시작 가능.' })
  async forceStart(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.dev.forceStart(id, u.userId) };
  }

  @Post('matches/:id/finish')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '게임 종료 시뮬레이션', description: '남은 모든 턴을 서버 오토 전략·엔진 규칙으로 진행(점수 임의 지정 아님).' })
  async finish(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.dev.finish(id, u.userId) };
  }

  @Post('reset')
  @HttpCode(200)
  @ApiOperation({ summary: '테스트 데이터 초기화', description: '테스트 방·게임 삭제. 실제 사용자(HUMAN) 데이터는 유지.' })
  @ApiJsonBody(ResetInput, { accounts: false })
  async reset(@Body() body: unknown) {
    return { data: await this.dev.reset(parseInput(ResetInput, body)) };
  }
}
