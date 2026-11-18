import { Global, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@assetnest/config';
import { createDatabase, type Database } from '@assetnest/db';
import { APP_CONFIG, DATABASE } from './common/tokens.js';

/**
 * Global module providing the application config and the database handle.
 * @Global() makes them injectable everywhere without re-importing —
 * createDatabase() only builds a pg Pool (no connection until first query),
 * so importing this module is side-effect free for liveness checks.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
    {
      provide: DATABASE,
      useFactory: (config: AppConfig): Database =>
        createDatabase(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [APP_CONFIG, DATABASE],
})
export class DatabaseModule {}
