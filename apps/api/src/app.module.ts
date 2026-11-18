import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { createDatabase, type Database } from '@assetnest/db';
import { APP_CONFIG, DATABASE } from './common/tokens.js';
import { HealthController } from './health/health.controller.js';
import { VersionController } from './version/version.controller.js';

/**
 * Application root module.
 *
 * Config is provided under the APP_CONFIG token via a factory (not a module-
 * level useValue) so `loadConfig()` is evaluated lazily at DI time. This keeps
 * fail-fast semantics — an invalid environment aborts boot before any route is
 * served — while allowing tests to override APP_CONFIG cleanly.
 *
 * createDatabase() only constructs a pg Pool; no connection is opened until
 * the first query, so importing/bootstrapping the module is side-effect free
 * for liveness checks.
 */
@Module({
  controllers: [HealthController, VersionController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
    {
      provide: DATABASE,
      useFactory: (config: AppConfig): Database => createDatabase(config.DATABASE_URL),
      inject: [APP_CONFIG],
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end().catch(() => {
      // Pool already closing/closed — nothing actionable at shutdown.
    });
  }
}
