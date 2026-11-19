import { Module } from '@nestjs/common';
import { NotificationPreferencesController } from './preferences.controller.js';

@Module({
  controllers: [NotificationPreferencesController],
})
export class NotificationsModule {}
