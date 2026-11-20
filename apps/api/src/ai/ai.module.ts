import { Module } from '@nestjs/common';
import { aiProviderRegistry, createProviderTransport, validateProviderEndpoint } from '@assetnest/ai';
import {
  AI_PROVIDER_REGISTRY,
  AI_PROVIDER_TRANSPORT,
  AiConnectionDiagnosticsService,
} from './ai-connection-diagnostics.service.js';
import { AiConnectionsController } from './ai-connections.controller.js';
import { AI_ENDPOINT_VALIDATOR, AiConnectionsService } from './ai-connections.service.js';
import { AiFeatureGuard } from './ai-feature.guard.js';
import { AiModelsController } from './ai-models.controller.js';
import { AiModelsService } from './ai-models.service.js';
import { AiRoutesController } from './ai-routes.controller.js';
import { AiRoutesService } from './ai-routes.service.js';

@Module({
  controllers: [AiConnectionsController, AiModelsController, AiRoutesController],
  providers: [
    AiConnectionsService,
    AiConnectionDiagnosticsService,
    AiModelsService,
    AiRoutesService,
    AiFeatureGuard,
    { provide: AI_ENDPOINT_VALIDATOR, useValue: validateProviderEndpoint },
    { provide: AI_PROVIDER_REGISTRY, useValue: aiProviderRegistry },
    { provide: AI_PROVIDER_TRANSPORT, useValue: createProviderTransport },
  ],
})
export class AiModule {}
