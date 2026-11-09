import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';

@Module({ imports: [AuthModule], controllers: [OAuthController], providers: [OAuthService] })
export class OAuthModule {}
