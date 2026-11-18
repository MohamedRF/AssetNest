import { Pool, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/**
 * Create a pooled database handle for the API/worker/scripts.
 * Callers own the lifecycle: `await db.$client.end()` on shutdown closes the pool.
 */
export function createDatabase(connectionString: string, poolConfig?: PoolConfig): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    ...poolConfig,
  });
  return drizzle(pool, { schema });
}

export { schema };
