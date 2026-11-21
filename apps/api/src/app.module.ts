import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { McpModule } from '@nestjs/mcp';
import { PERMISSIONS } from '@assetnest/domain';
import type { Database } from '@assetnest/db';
import type { AppConfig } from '@assetnest/config';
import { APP_CONFIG, DATABASE } from './common/tokens.js';
import { Public } from './common/public.decorator.js';
import { DatabaseModule } from './database.module.js';
import { McpProvidersModule } from './mcp/mcp-providers.module.js';
import { AssetNestMcpVerifier } from './mcp/mcp-verifier.js';
import { HealthController } from './health/health.controller.js';
import { VersionController } from './version/version.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { OrgModule } from './org/org.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { CustodyModule } from './custody/custody.module.js';
import { WarrantiesModule } from './warranties/warranties.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AuditsModule } from './audits/audits.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { PoliciesModule } from './policies/policies.module.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { ApiTokensModule } from './api-tokens/api-tokens.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { AiModule } from './ai/ai.module.js';
import { AiWorkflowsModule } from './ai/ai-workflows.module.js';

/**
 * MCP (Model Context Protocol, revision 2026-07-28) is OPTIONAL and off by
 * default: with MCP_ENABLED unset the /api/v1/mcp endpoint is not mounted at
 * all. When enabled it is served read-plus-write over first-party `anst_`
 * API tokens bound to one workspace each (verifier below), with per-tool
 * scope enforcement, an in-memory rate limit and audit logging of every
 * mutation.
 */
const MCP_ENABLED = process.env['MCP_ENABLED'] === 'true';
const mcpHostsFor = (config: AppConfig): string[] => {
  try {
    const host = new URL(config.PUBLIC_APP_URL).hostname;
    return [...new Set([host, 'localhost', '127.0.0.1', '[::1]'])];
  } catch {
    return ['localhost', '127.0.0.1', '[::1]'];
  }
};

const mcpRootModule = McpModule.forRootAsync({
  imports: [McpProvidersModule],
  inject: [APP_CONFIG, AssetNestMcpVerifier],
  path: 'mcp',
  // The MCP endpoint authenticates via its own verifier; exempt it from the
  // global session/CSRF/workspace guards (they are for cookie sessions and
  // :workspaceId-routed REST paths).
  decorators: [Public()],
  useFactory: (config: AppConfig, verifier: AssetNestMcpVerifier) => ({
    name: 'assetnest',
    version: '0.1.0',
    title: 'AssetNest',
    websiteUrl: config.PUBLIC_APP_URL,
    instructions:
      'AssetNest asset management workspace. Use assets_list/assets_get to find assets; pass expectedVersion on every assets_update/transition/custody call. ' +
      'Read-heavy flows: workspace_summary first. All actions are bound to the token’s workspace and scoped by the token’s scopes; request elevated scopes with your admin when a call returns insufficient_scope.',
    http: {
      allowedOrigins: mcpHostsFor(config),
      allowedHosts: mcpHostsFor(config),
      // Default 'stateless': 2025-era clients are served statelessly against
      // the same tools; 2026-07-28 clients get the modern per-request era.
    },
    auth: {
      verifier,
      resource: AssetNestMcpVerifier.resourceFor(config),
      authorizationServers: [new URL(config.PUBLIC_APP_URL).origin],
      scopesSupported: [...PERMISSIONS],
      resourceName: 'AssetNest MCP',
    },
  }),
});

/** Application root module. */
@Module({
  imports: [
    DatabaseModule,
    ...(MCP_ENABLED ? [mcpRootModule] : []),
    AuthModule,
    WorkspacesModule,
    OrgModule,
    AssetsModule,
    DocumentsModule,
    CustodyModule,
    MaintenanceModule,
    WarrantiesModule,
    NotificationsModule,
    AuditsModule,
    ImportsModule,
    ExportsModule,
    PoliciesModule,
    ApprovalsModule,
    ApiTokensModule,
    WebhooksModule,
    AiModule,
    AiWorkflowsModule,
  ],
  controllers: [HealthController, VersionController],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    // Tests may override DATABASE with an embedded engine without a `$client` pool.
    const pool = (this.db as Database | undefined)?.$client;
    if (pool && typeof pool.end === 'function') {
      await pool.end().catch(() => {
        // Pool already closing/closed — nothing actionable at shutdown.
      });
    }
  }
}
