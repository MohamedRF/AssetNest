import { Module } from '@nestjs/common';
import type { AppConfig } from '@assetnest/config';
import { APP_CONFIG } from '../common/tokens.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { LocalStorage } from './storage.js';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    {
      provide: LocalStorage,
      useFactory: (config: AppConfig): LocalStorage => {
        if (config.STORAGE_DRIVER !== 'local') {
          // Honest fail-fast: S3-compatible storage is a Phase 6 deliverable.
          throw new Error(
            `STORAGE_DRIVER='${config.STORAGE_DRIVER}' is not implemented yet — set STORAGE_DRIVER=local`,
          );
        }
        return new LocalStorage(config.STORAGE_ROOT);
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
