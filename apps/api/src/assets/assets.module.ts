import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { QrService } from './qr.service.js';

@Module({
  imports: [ApprovalsModule],
  controllers: [AssetsController],
  providers: [AssetsService, QrService],
  exports: [AssetsService],
})
export class AssetsModule {}
