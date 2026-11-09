import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { GameGateway } from '../realtime/game.gateway.js';
import { RoomsController } from '../rooms/rooms.controller.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { MatchesController } from '../matches/matches.controller.js';
import { MatchesService } from '../matches/matches.service.js';
import { ChatService } from '../chat/chat.service.js';
import { InvitesService } from '../invites/invites.service.js';
import { InvitesController } from '../invites/invites.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [RoomsController, MatchesController, InvitesController],
  providers: [RealtimeService, RoomsService, MatchesService, ChatService, InvitesService, GameGateway],
  exports: [RoomsService, MatchesService, ChatService],
})
export class GameModule {}
