import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LifecycleService } from './lifecycle.service.js';

@Global()
@Module({ controllers: [HealthController], providers: [LifecycleService], exports: [LifecycleService] })
export class HealthModule {}
