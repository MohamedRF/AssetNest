import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { WORKSPACE_ROLES } from '@assetnest/domain';
import * as schema from './schema.js';
import { seedRoles, seedAdmin, seedDemoWorkspaces } from './seed-lib.js';
import type { Database } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '..', 'migrations');

/** Drizzle wraps driver errors — walk the cause chain to find the real PG message. */
async function expectPgError(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise;
  } catch (error) {
    let current: unknown = error;
    while (current) {
      const message = current instanceof Error ? current.message : String(current);
      if (pattern.test(message)) return;
      current = (current as { cause?: unknown }).cause;
    }
    throw new Error(`Expected PG error matching ${pattern}, got: ${(error as Error).message}`, {
      cause: error,
    });
  }
  throw new Error(`Expected PG error matching ${pattern}, but the query succeeded`);
}

/**
 * Integration test against a real (WASM) PostgreSQL via PGlite.
 * Applies the full migration chain from empty, then exercises constraints.
 * CI runs the same migration chain against a PostgreSQL service container.
 */
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('migrations from empty database', () => {
  it('creates all expected tables', async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = result.rows.map((r) => r.table_name);
    for (const expected of [
      'users',
      'workspaces',
      'roles',
      'role_permissions',
      'memberships',
      'sessions',
      'audit_log',
      'locations',
      'categories',
      'vendors',
      'asset_models',
      'assets',
      'asset_custom_values',
      'asset_tags',
      'asset_events',
      'asset_assignments',
      'asset_transfers',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('enforces one ACTIVE assignment per asset (partial unique index)', async () => {
    // seed fixtures: roles, admin, workspaces, one asset, two memberships
    await seedRoles(db as unknown as Database);
    const admin = await seedAdmin(db as unknown as Database, 'admin@test.local', 'a-strong-password-123');
    await seedDemoWorkspaces(db as unknown as Database, admin.id);

    const rows = await db.execute<{ id: string }>(sql`select id from workspaces where slug = 'home-demo'`);
    const workspaceId = rows.rows[0]!.id;
    const membership = (
      await db.execute<{ id: string }>(
        sql`select id from memberships where workspace_id = ${workspaceId} and user_id = ${admin.id}`,
      )
    ).rows[0]!;

    const asset = (
      await db.execute<{ id: string }>(
        sql`insert into assets (workspace_id, asset_tag, display_name) values (${workspaceId}, 'FIX-0001', 'Test asset') returning id`,
      )
    ).rows[0]!;

    await db.execute(
      sql`insert into asset_assignments (workspace_id, asset_id, member_id) values (${workspaceId}, ${asset.id}, ${membership.id})`,
    );
    await expectPgError(
      db.execute(
        sql`insert into asset_assignments (workspace_id, asset_id, member_id) values (${workspaceId}, ${asset.id}, ${membership.id})`,
      ),
      /duplicate|unique/i,
    );
  });

  it('allows the same asset tag in different workspaces but not within one', async () => {
    const wsRows = await db.execute<{ id: string; slug: string }>(sql`select id, slug from workspaces`);
    const home = wsRows.rows.find((r) => r.slug === 'home-demo')!;
    const office = wsRows.rows.find((r) => r.slug === 'office-demo')!;

    await db.execute(
      sql`insert into assets (workspace_id, asset_tag, display_name) values (${office.id}, 'FIX-0001', 'Office twin tag')`,
    );
    // home-demo already has FIX-0001 from the previous test → must fail
    await expectPgError(
      db.execute(
        sql`insert into assets (workspace_id, asset_tag, display_name) values (${home.id}, 'FIX-0001', 'Duplicate tag')`,
      ),
      /duplicate|unique/i,
    );
  });

  it('enforces asset status closed-domain check', async () => {
    const wsRows = await db.execute<{ id: string }>(sql`select id from workspaces where slug = 'home-demo'`);
    const workspaceId = wsRows.rows[0]!.id;
    await expectPgError(
      db.execute(
        sql`insert into assets (workspace_id, asset_tag, display_name, status) values (${workspaceId}, 'FIX-0002', 'Bad status', 'banana')`,
      ),
      /check|violat/i,
    );
  });
});

describe('seed determinism', () => {
  it('is idempotent — re-running does not duplicate roles or memberships', async () => {
    await seedRoles(db as unknown as Database);
    await seedRoles(db as unknown as Database);
    const roleCount = await db.execute<{ count: string }>(sql`select count(*) from roles`);
    expect(Number(roleCount.rows[0]!.count)).toBe(WORKSPACE_ROLES.length);

    const admin = await seedAdmin(db as unknown as Database, 'admin@test.local', 'a-strong-password-123');
    expect(admin.created).toBe(false);
    await seedDemoWorkspaces(db as unknown as Database, admin.id);
    const membershipCount = await db.execute<{ count: string }>(
      sql`select count(*) from memberships where user_id = ${admin.id}`,
    );
    expect(Number(membershipCount.rows[0]!.count)).toBe(2);
  });
});
