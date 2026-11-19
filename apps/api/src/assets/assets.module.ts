import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { QrService } from './qr.service.js';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, QrService],
  exports: [AssetsService],
})
export class AssetsModule {}
