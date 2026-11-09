import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GameModule } from '../game/game.module.js';
import { DevController } from './dev.controller.js';
import { DevService } from './dev.service.js';

@Module({ imports: [AuthModule, GameModule], controllers: [DevController], providers: [DevService] })
export class DevModule {}
