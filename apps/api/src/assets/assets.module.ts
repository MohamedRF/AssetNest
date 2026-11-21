import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { PoliciesModule } from '../policies/policies.module.js';
import { AssetLabelExportController } from './asset-label-export.controller.js';
import { AssetLabelExportService } from './asset-label-export.service.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { QrService } from './qr.service.js';

@Module({
  imports: [ApprovalsModule, PoliciesModule],
  controllers: [AssetsController, AssetLabelExportController],
  providers: [AssetsService, QrService, AssetLabelExportService],
  exports: [AssetsService],
})
export class AssetsModule {}
