import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { RateLimitService } from "./rate-limit.service.js";

@Global()
@Module({ providers: [RedisService, RateLimitService], exports: [RedisService, RateLimitService] })
export class RedisModule {}
