import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import { AiTaskDraftsService } from './ai-task-drafts.service.js';
import { AI_TASK_ADAPTER, AiTaskExecutor, providerForTask } from './ai-task-executor.service.js';
import { AiTasksController } from './ai-tasks.controller.js';

@Module({
  imports: [AssetsModule, DocumentsModule],
  controllers: [AiTasksController],
  providers: [
    AiFeatureGuard,
    AiTaskDraftsService,
    AiTaskExecutor,
    { provide: AI_TASK_ADAPTER, useValue: providerForTask },
  ],
})
export class AiWorkflowsModule {}
