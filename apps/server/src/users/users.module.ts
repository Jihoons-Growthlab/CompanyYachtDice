import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { PreferencesController } from '../preferences/preferences.controller.js';

@Module({ controllers: [UsersController, PreferencesController] })
export class UsersModule {}
