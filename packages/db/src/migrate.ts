import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '..', 'migrations');

/**
 * Migration runner deliberately does NOT load the full application config —
 * applying migrations must not require app secrets (SESSION_SECRET etc.).
 * Only DATABASE_URL is required, matching the CI migrations job and
 * infrastructure/compose/compose.yaml.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[db] DATABASE_URL is required to run migrations');
  process.exit(1);
}

async function main() {
  const db = createDatabase(databaseUrl!, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    console.warn(`[db] migrations applied from ${migrationsFolder}`);
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error('[db] migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
