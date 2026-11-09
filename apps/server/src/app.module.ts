import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
import { GameModule } from './game/game.module.js';
import { DevModule } from './dev/dev.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        PrismaModule,
        RedisModule,
        HealthModule,
        AuthModule,
        UsersModule,
        OAuthModule,
        GameModule,
        // 개발 테스트 경로는 테스트 모드(로컬 DB·비운영)에서만 등록 → 운영에서는 존재하지 않음(404)
        ...(env.testMode ? [DevModule] : []),
      ],
    };
  }
}
