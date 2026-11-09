import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { parseInput } from '../common/validation.js';
import { ApiErrors } from '../common/openapi.js';
import { InvitesService } from './invites.service.js';

const SearchQuery = z.object({ q: z.string().trim().min(1).max(24) });

@ApiTags('게임방')
@ApiBearerAuth('access')
@ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED · TOKEN_INVALID'])
@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get('users/search')
  @ApiQuery({ name: 'q', description: '사원명 일부' })
  @ApiOperation({ summary: '사원 검색(초대 대상)', description: '인사 등록 완료 사용자, 최대 10명, online 표시' })
  async search(@CurrentUser() u: AuthUser, @Query() q: unknown) {
    return { data: { items: await this.invites.searchUsers(parseInput(SearchQuery, q).q, u.userId) } };
  }

  @Get('me/room-invites')
  @ApiOperation({ summary: '받은 초대(대기 중, 만료 제외)' })
  async mine(@CurrentUser() u: AuthUser) {
    return { data: { items: await this.invites.listMine(u.userId) } };
  }

  @Post('room-invites/:id/accept')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '초대 수락 → 입장', description: '서버가 WAITING·정원을 다시 검사. 비공개 방 코드 생략. 실패하면 초대는 대기 상태 유지.' })
  @ApiErrors([404, 'INVITE_NOT_FOUND'], [409, 'INVITE_NOT_PENDING · INVITE_EXPIRED · ROOM_FULL · ROOM_NOT_WAITING'])
  async accept(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.invites.respond(id, u.userId, true) };
  }

  @Post('room-invites/:id/decline')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '초대 거절' })
  @ApiErrors([404, 'INVITE_NOT_FOUND'], [409, 'INVITE_NOT_PENDING · INVITE_EXPIRED'])
  async decline(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.invites.respond(id, u.userId, false) };
  }
}
