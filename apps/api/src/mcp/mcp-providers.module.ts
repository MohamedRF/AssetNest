import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module.js';
import { CustodyModule } from '../custody/custody.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { OrgModule } from '../org/org.module.js';
import { WarrantiesModule } from '../warranties/warranties.module.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { AuditsModule } from '../audits/audits.module.js';
import { ImportsModule } from '../imports/imports.module.js';
import { ExportsModule } from '../exports/exports.module.js';
import { ApiTokensModule } from '../api-tokens/api-tokens.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { McpRateLimiter } from './rate-limiter.service.js';
import { AssetNestMcpVerifier } from './mcp-verifier.js';
import { AssetsMcpTools } from './tools/assets.tools.js';
import { OrgMcpTools } from './tools/org.tools.js';
import { WarrantiesMaintenanceMcpTools } from './tools/warranties-maintenance.tools.js';
import { AuditsExportsMcpTools } from './tools/audits-exports.tools.js';
import { WorkspaceMcpTools } from './tools/workspace.tools.js';
import { IntegrationsMcpTools } from './tools/integrations.tools.js';
import { AssetNestMcpResources } from './resources.js';
import { AssetNestMcpPrompts } from './prompts.js';

/**
 * Everything the MCP server needs. Registered (as an McpModule include)
 * only when MCP_ENABLED=true — see app.module.ts.
 */
@Module({
  imports: [
    AssetsModule,
    CustodyModule,
    DocumentsModule,
    OrgModule,
    WarrantiesModule,
    MaintenanceModule,
    AuditsModule,
    ImportsModule,
    ExportsModule,
    ApiTokensModule,
    WebhooksModule,
    WorkspacesModule,
  ],
  providers: [
    McpRateLimiter,
    AssetNestMcpVerifier,
    AssetsMcpTools,
    OrgMcpTools,
    WarrantiesMaintenanceMcpTools,
    AuditsExportsMcpTools,
    WorkspaceMcpTools,
    IntegrationsMcpTools,
    AssetNestMcpResources,
    AssetNestMcpPrompts,
  ],
  exports: [AssetNestMcpVerifier],
})
export class McpProvidersModule {}
