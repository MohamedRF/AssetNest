/**
 * Local development database without Docker: an embedded PostgreSQL (PGlite)
 * served over the pg wire protocol by @electric-sql/pglite-socket.
 *
 *   pnpm --filter @assetnest/db dev:pglite
 *
 * Then, in another shell:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres pnpm --filter @assetnest/api dev
 *
 * Options (env):
 *   PGLITE_PORT        — listen port (default 55432)
 *   SEED_ADMIN_EMAIL    — when set with SEED_ADMIN_PASSWORD, ensures a bootstrap admin + demo workspaces
 *   SEED_ADMIN_PASSWORD — min 12 chars
 *   PGLITE_DB_PATH      — persist to a file path instead of in-memory (default memory://)
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as schema from '../dist/schema.js';
import { seedRoles, seedAdmin, seedDemoWorkspaces } from '../dist/seed-lib.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '..', 'migrations');
const port = Number.parseInt(process.env.PGLITE_PORT ?? '55432', 10);
const dbPath = process.env.PGLITE_DB_PATH ?? 'memory://';

const client = new PGlite(dbPath === 'memory://' ? undefined : dbPath);
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder });
await seedRoles(db);
console.warn('[dev-pglite] migrations applied; role catalog seeded');

if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
  const admin = await seedAdmin(db, process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD);
  await seedDemoWorkspaces(db, admin.id);
  console.warn(
    `[dev-pglite] bootstrap admin ${admin.created ? 'created' : 'ready'}; demo workspaces present`,
  );
} else {
  console.warn('[dev-pglite] SEED_ADMIN_EMAIL/PASSWORD not set; skipping admin and demo data');
}

const server = new PGLiteSocketServer({ db: client, port, host: '127.0.0.1' });
await server.start();
console.warn(`[dev-pglite] PostgreSQL wire protocol on postgresql://postgres@127.0.0.1:${port}/postgres`);

process.on('SIGINT', async () => {
  await server.stop();
  await client.close();
  process.exit(0);
});
