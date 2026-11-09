import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { parseInput } from '../common/validation.js';
import { ApiData, ApiErrors, ApiJsonBody } from '../common/openapi.js';
import { MatchCommandInput, MatchSnapshotSchema, PlayModeInput } from './match.dto.js';
import { MatchesService } from './matches.service.js';

const Id = ApiParam({ name: 'id', format: 'uuid', description: '게임(매치) ID' });

@ApiTags('게임')
@ApiBearerAuth('access')
@ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED · TOKEN_INVALID'])
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get(':id')
  @Id
  @ApiOperation({ summary: '게임 스냅샷', description: '참여자·방 멤버만. 새로고침·재접속 시 현재 턴 복원용.' })
  @ApiData(200, '게임 스냅샷', MatchSnapshotSchema)
  @ApiErrors([403, 'NOT_MATCH_PLAYER'], [404, 'MATCH_NOT_FOUND'])
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.matches.get(id, u.userId) };
  }

  @Post(':id/commands')
  @HttpCode(200)
  @Id
  @ApiOperation({
    summary: '게임 명령(굴림·보관·기록)',
    description:
      'Socket.IO match:roll/hold/score 와 같은 처리. 서버가 차례·굴림 횟수(3)·보관·칸 중복을 검증하고 주사위를 정한다. ' +
      'expectedVersion 이 다르면 STALE_VERSION, 같은 commandId 재전송은 현재 상태 반환(중복 처리 없음).',
  })
  @ApiJsonBody(MatchCommandInput, { commandId: '0b9a3f0e-3c2e-4b1a-9f7e-2a1d4c5b6e7f', expectedVersion: 0, type: 'ROLL' })
  @ApiData(200, '게임 스냅샷', MatchSnapshotSchema)
  @ApiErrors(
    [400, 'VALIDATION_FAILED'],
    [403, 'NOT_MATCH_PLAYER'],
    [404, 'MATCH_NOT_FOUND'],
    [409, 'STALE_VERSION · IDEMPOTENCY_CONFLICT · NOT_YOUR_TURN · ROLL_LIMIT · ALL_HELD · NO_ROLL_YET · CATEGORY_FILLED · MATCH_FINISHED'],
  )
  async command(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.matches.command(id, u.userId, parseInput(MatchCommandInput, body)) };
  }

  @Post(':id/briefing')
  @HttpCode(200)
  @Id
  @ApiOperation({
    summary: '시작 안내 확인(또는 건너뛰기)',
    description: '게임 시작 직후 안내 단계(phase=BRIEFING)에서 호출. 사람 참여자가 모두 확인하면 첫 턴 기한이 시작된다. 안내 단계가 아니면 아무 변화 없이 현재 상태 반환(멱등).',
  })
  @ApiData(200, '게임 스냅샷', MatchSnapshotSchema)
  @ApiErrors([403, 'NOT_MATCH_PLAYER'], [404, 'MATCH_NOT_FOUND'])
  async briefing(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.matches.briefed(id, u.userId) };
  }

  @Post(':id/mode')
  @HttpCode(200)
  @Id
  @ApiOperation({ summary: '오토 모드 켜기/끄기', description: 'AUTO 면 서버가 같은 규칙으로 대신 진행. MANUAL 로 자리 비움(AWAY)도 해제.' })
  @ApiJsonBody(PlayModeInput, { mode: 'AUTO' })
  @ApiData(200, '게임 스냅샷', MatchSnapshotSchema)
  @ApiErrors([403, 'NOT_MATCH_PLAYER'], [409, 'MATCH_FINISHED'])
  async mode(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.matches.setMode(id, u.userId, parseInput(PlayModeInput, body).mode) };
  }
}
