import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { parseInput } from '../common/validation.js';
import { ApiData, ApiErrors, ApiJsonBody } from '../common/openapi.js';
import { MatchSnapshotSchema } from '../matches/match.dto.js';
import { CreateRoomInput, InviteInput, JoinInput, ReadyInput, RoomListItemSchema, RoomSnapshotSchema, UpdateRoomInput } from './room.dto.js';
import { ChatService } from '../chat/chat.service.js';
import { ChatMessageSchema, HistoryQuery, SendMessageInput } from '../chat/chat.dto.js';
import { InvitesService } from '../invites/invites.service.js';
import { RoomsService } from './rooms.service.js';

const Id = ApiParam({ name: 'id', format: 'uuid', description: '방 ID' });
const AuthErr = ApiErrors([401, 'AUTH_REQUIRED · TOKEN_EXPIRED · TOKEN_INVALID']);

@ApiTags('게임방')
@ApiBearerAuth('access')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService, private readonly chat: ChatService, private readonly invites: InvitesService) {}

  @Get()
  @ApiOperation({ summary: '대기 중인 방 목록', description: '최신순 최대 50개. 테스트 모드가 아니면 테스트 방 제외.' })
  @ApiData(200, '목록', z.object({ items: z.array(RoomListItemSchema) }))
  @AuthErr
  async list() {
    return { data: { items: await this.rooms.list() } };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '방 만들기', description: '만든 사람이 방장(PL)이 되고 자동 입장. 인사 등록 필요.' })
  @ApiJsonBody(CreateRoomInput, { name: '11월 정기 업무 평가', capacity: 4, turnTimeLimitSec: 180 })
  @ApiData(201, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([400, 'VALIDATION_FAILED'], [401, 'AUTH_REQUIRED'], [403, 'PROFILE_REQUIRED'])
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return { data: await this.rooms.create(u.userId, parseInput(CreateRoomInput, body)) };
  }

  @Get('current')
  @ApiOperation({ summary: '내가 참여 중인 방(새로고침 복원용)', description: '대기·진행 중인 방 중 가장 최근 입장한 방. 없으면 null.' })
  @ApiData(200, '방 스냅샷 또는 null', { oneOf: [{ type: 'object' }, { type: 'null' }] })
  @AuthErr
  async current(@CurrentUser() u: AuthUser) {
    return { data: await this.rooms.current(u.userId) };
  }

  @Get(':id')
  @Id
  @ApiOperation({ summary: '방 스냅샷(참여자만)', description: 'start.blockers 로 시작 불가 사유를 알려준다.' })
  @ApiData(200, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([401, 'AUTH_REQUIRED'], [403, 'NOT_ROOM_MEMBER'], [404, 'ROOM_NOT_FOUND'])
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.rooms.get(id, u.userId) };
  }

  @Patch(':id')
  @Id
  @ApiOperation({ summary: '방 설정 변경(방장, 대기 중)', description: '정원 2–6(현재 인원 이상), 턴 제한시간 60/120/180/240/300초(테스트 모드 3–300).' })
  @ApiJsonBody(UpdateRoomInput, { turnTimeLimitSec: 120 })
  @ApiData(200, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([400, 'VALIDATION_FAILED'], [403, 'NOT_ROOM_OWNER'], [409, 'ROOM_NOT_WAITING · CAPACITY_BELOW_MEMBERS'])
  @AuthErr
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.rooms.update(id, u.userId, parseInput(UpdateRoomInput, body)) };
  }

  @Post(':id/join')
  @HttpCode(200)
  @Id
  @ApiOperation({ summary: '입장', description: '대기 중·정원 미만일 때. 비공개 방은 code 필요(초대 수락 시 생략). 이미 참여 중이면 그대로 성공(멱등).' })
  @ApiJsonBody(JoinInput, { code: 'K7M2QX' })
  @ApiData(200, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([403, 'PROFILE_REQUIRED · JOIN_CODE_REQUIRED · JOIN_CODE_INVALID'], [404, 'ROOM_NOT_FOUND'], [409, 'ROOM_FULL · ROOM_NOT_WAITING'])
  @AuthErr
  async join(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.rooms.join(id, u.userId, { code: parseInput(JoinInput, body ?? {}).code }) };
  }

  @Post(':id/bots')
  @Id
  @ApiOperation({ summary: '봇 추가(방장)', description: '봇 허용 방에서만. 봇은 자동 준비·서버 자동 진행.' })
  @ApiData(201, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([403, 'NOT_ROOM_OWNER'], [409, 'BOTS_NOT_ALLOWED · ROOM_FULL · ROOM_NOT_WAITING'])
  @AuthErr
  async addBot(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.rooms.addBot(id, u.userId) };
  }

  @Delete(':id/bots/:botId')
  @Id
  @ApiParam({ name: 'botId', format: 'uuid' })
  @ApiOperation({ summary: '봇 제외(방장)' })
  @ApiData(200, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([403, 'NOT_ROOM_OWNER · NOT_ROOM_MEMBER'], [409, 'ROOM_NOT_WAITING'])
  @AuthErr
  async removeBot(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('botId') botId: string) {
    return { data: await this.rooms.removeBot(id, u.userId, botId) };
  }

  @Post(':id/invites')
  @Id
  @ApiOperation({ summary: '사원 초대(방장)', description: `대상에게 실시간 알림(invite:received). 같은 대상에게 대기 중 초대가 있으면 그 초대를 반환. 유효 ${10}분.` })
  @ApiJsonBody(InviteInput, { targetUserId: '019a…' })
  @ApiErrors([403, 'NOT_ROOM_OWNER'], [409, 'ROOM_NOT_WAITING · INVITE_INVALID_TARGET'])
  @AuthErr
  async invite(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.invites.create(id, u.userId, parseInput(InviteInput, body).targetUserId) };
  }

  @Get(':id/messages')
  @Id
  @ApiOperation({ summary: '채팅 기록(참여자만)', description: '오름차순. 기본 최근 50개. beforeSeq: 이전 페이지, afterSeq: 재접속 누락 보충.' })
  @ApiData(200, '메시지', z.object({ items: z.array(ChatMessageSchema), hasMore: z.boolean() }))
  @ApiErrors([403, 'NOT_ROOM_MEMBER'])
  @AuthErr
  async messages(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: unknown) {
    return { data: await this.chat.history(id, u.userId, parseInput(HistoryQuery, q)) };
  }

  @Post(':id/messages')
  @Id
  @ApiOperation({ summary: '채팅 보내기', description: 'Socket.IO chat:send 와 같은 처리. 작성자는 인증 정보로 서버가 지정. 1–300자, 10줄, 사용자별 10초 5건.' })
  @ApiJsonBody(SendMessageInput, { clientMessageId: '0b9a3f0e-3c2e-4b1a-9f7e-2a1d4c5b6e7f', text: '잘 부탁드립니다' })
  @ApiData(201, '저장된 메시지', ChatMessageSchema)
  @ApiErrors([400, 'VALIDATION_FAILED'], [403, 'NOT_ROOM_MEMBER'], [429, 'RATE_LIMITED'])
  @AuthErr
  async send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.chat.send(id, u.userId, parseInput(SendMessageInput, body)) };
  }

  @Post(':id/leave')
  @HttpCode(200)
  @Id
  @ApiOperation({
    summary: '퇴장',
    description: '대기 중: 퇴장, 방장이면 가장 오래된 참여자에게 위임, 남은 사람이 없으면 방 닫힘(data=null). 진행 중: 좌석 유지 + 자리 비움(서버 자동 진행).',
  })
  @ApiData(200, '방 스냅샷 또는 null(닫힘)', { oneOf: [{ type: 'object' }, { type: 'null' }] })
  @ApiErrors([403, 'NOT_ROOM_MEMBER'], [404, 'ROOM_NOT_FOUND'])
  @AuthErr
  async leave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.rooms.leave(id, u.userId) };
  }

  @Post(':id/ready')
  @HttpCode(200)
  @Id
  @ApiOperation({ summary: '준비 / 준비 취소' })
  @ApiJsonBody(ReadyInput, { ready: true })
  @ApiData(200, '방 스냅샷', RoomSnapshotSchema)
  @ApiErrors([403, 'NOT_ROOM_MEMBER'], [409, 'ROOM_NOT_WAITING'])
  @AuthErr
  async ready(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.rooms.setReady(id, u.userId, parseInput(ReadyInput, body).ready) };
  }

  @Post(':id/start')
  @HttpCode(200)
  @Id
  @ApiOperation({
    summary: '게임 시작(방장)',
    description: '조건: 대기 중, 2명 이상, 정원 이하, 방장 외 전원 준비. 서버가 좌석 순서를 섞고 첫 턴 기한을 정한다. 이미 시작됐으면 진행 중 게임을 반환(중복 시작 방지).',
  })
  @ApiData(200, '방·게임 스냅샷', z.object({ room: RoomSnapshotSchema, match: MatchSnapshotSchema }))
  @ApiErrors([403, 'NOT_ROOM_OWNER'], [409, 'START_CONDITIONS_UNMET (details.blockers: NOT_ENOUGH_PLAYERS · NOT_ALL_READY · OVER_CAPACITY · NOT_WAITING)'])
  @AuthErr
  async start(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.rooms.start(id, u.userId) };
  }
}
