import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import type { Database } from '@assetnest/db';
import { DATABASE } from './common/tokens.js';
import { DatabaseModule } from './database.module.js';
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

/** Application root module. */
@Module({
  imports: [
    DatabaseModule,
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
