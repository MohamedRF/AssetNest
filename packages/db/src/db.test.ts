import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq, sql } from 'drizzle-orm';
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
      'ai_connections',
      'ai_models',
      'ai_task_routes',
      'ai_jobs',
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

describe('AI connection migration', () => {
  it('isolates connection names by workspace and enforces endpoint and credential invariants', async () => {
    const [first, second] = await db
      .insert(schema.workspaces)
      .values([
        { name: 'AI connection first workspace', slug: 'ai-db-first' },
        { name: 'AI connection second workspace', slug: 'ai-db-second' },
      ])
      .returning({ id: schema.workspaces.id });
    const local = {
      kind: 'ollama',
      name: 'Ollama',
      endpoint: 'http://models.example.test:11434',
    } satisfies Partial<typeof schema.aiConnections.$inferInsert>;

    const [connection] = await db
      .insert(schema.aiConnections)
      .values({ ...local, workspaceId: first!.id })
      .returning({ enabled: schema.aiConnections.enabled, mode: schema.aiConnections.credentialMode });
    expect(connection).toEqual({ enabled: true, mode: 'none' });
    await expectPgError(
      db.insert(schema.aiConnections).values({ ...local, workspaceId: first!.id }),
      /ai_connections_workspace_name_unique/,
    );
    await db.insert(schema.aiConnections).values({ ...local, workspaceId: second!.id });

    const native = {
      workspaceId: first!.id,
      kind: 'openai',
      name: 'Native',
    } satisfies typeof schema.aiConnections.$inferInsert;
    await expectPgError(db.insert(schema.aiConnections).values(native), /ai_connections_credential_check/);
    await expectPgError(
      db.insert(schema.aiConnections).values({ ...native, credentialMode: 'api_key' }),
      /ai_connections_credential_check/,
    );
    const authenticatedNative = {
      ...native,
      credentialMode: 'api_key',
      encryptedCredential: 'ciphertext-fixture',
    } satisfies typeof schema.aiConnections.$inferInsert;
    await expectPgError(
      db
        .insert(schema.aiConnections)
        .values({ ...authenticatedNative, endpoint: 'https://custom.example.test' }),
      /ai_connections_endpoint_check/,
    );
    await db.insert(schema.aiConnections).values(authenticatedNative);
    await expectPgError(
      db.insert(schema.aiConnections).values({
        workspaceId: first!.id,
        kind: 'openai_compatible',
        name: 'Missing endpoint',
      }),
      /ai_connections_endpoint_check/,
    );
    await expectPgError(
      db.insert(schema.aiConnections).values({
        ...local,
        workspaceId: first!.id,
        name: 'Inconsistent credential',
        encryptedCredential: 'ciphertext-fixture',
      }),
      /ai_connections_credential_check/,
    );
  });

  it('retains existing assets and provider connections across the AI migrations', async () => {
    const previousMigrationsFolder = await mkdtemp(join(tmpdir(), 'assetnest-upgrade-'));
    const upgradeClient = new PGlite();
    const upgradeDb = drizzle(upgradeClient, { schema });
    try {
      const journalPath = join(migrationsFolder, 'meta', '_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      const previousEntries = journal.entries.filter((entry) => entry.idx <= 19);
      const previousMetaFolder = join(previousMigrationsFolder, 'meta');
      await mkdir(previousMetaFolder);
      await Promise.all([
        writeFile(
          join(previousMetaFolder, '_journal.json'),
          JSON.stringify({ ...journal, entries: previousEntries }),
        ),
        ...previousEntries.map(({ tag }) =>
          copyFile(join(migrationsFolder, `${tag}.sql`), join(previousMigrationsFolder, `${tag}.sql`)),
        ),
      ]);
      await migrate(upgradeDb, { migrationsFolder: previousMigrationsFolder });
      // Raw SQL (only pre-0023 columns): the live Drizzle schema already knows
      // about the newer policy columns, which do not exist at this point.
      const workspace = (
        await upgradeDb.execute<{ id: string }>(
          sql`insert into workspaces (name, slug) values ('Legacy workspace', 'legacy-before-ai') returning id`,
        )
      ).rows[0]!;
      const [legacyAsset] = await upgradeDb
        .insert(schema.assets)
        .values({ workspaceId: workspace!.id, assetTag: 'LEGACY-AI-001', displayName: 'Legacy asset' })
        .returning({ id: schema.assets.id });

      const connectionRevision = journal.entries.find(({ tag }) => tag === '0020_ai_connections');
      if (!connectionRevision) throw new Error('AI connection migration is missing');
      await Promise.all([
        copyFile(
          join(migrationsFolder, `${connectionRevision.tag}.sql`),
          join(previousMigrationsFolder, `${connectionRevision.tag}.sql`),
        ),
        writeFile(
          join(previousMetaFolder, '_journal.json'),
          JSON.stringify({ ...journal, entries: [...previousEntries, connectionRevision] }),
        ),
      ]);
      await migrate(upgradeDb, { migrationsFolder: previousMigrationsFolder });
      const [connection] = await upgradeDb
        .insert(schema.aiConnections)
        .values({
          workspaceId: workspace!.id,
          kind: 'ollama',
          name: 'After upgrade',
          endpoint: 'http://models.example.test:11434',
        })
        .returning({ id: schema.aiConnections.id });

      await migrate(upgradeDb, { migrationsFolder });
      await migrate(upgradeDb, { migrationsFolder });
      const remainingAssets = await upgradeDb.select({ id: schema.assets.id }).from(schema.assets);
      expect(remainingAssets).toEqual([legacyAsset]);
      const [model] = await upgradeDb
        .insert(schema.aiModels)
        .values({
          workspaceId: workspace!.id,
          connectionId: connection!.id,
          modelId: 'example-model',
          label: 'Model using an existing connection',
          capabilities: {},
        })
        .returning({ connectionId: schema.aiModels.connectionId });
      expect(model?.connectionId).toBe(connection!.id);
    } finally {
      await upgradeClient.close();
      await rm(previousMigrationsFolder, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('P6-01 workspace policy migration (0023)', () => {
  it('adds policy columns, preserves existing rows and backfills role permissions', async () => {
    const previousMigrationsFolder = await mkdtemp(join(tmpdir(), 'assetnest-upgrade-p6-'));
    const upgradeClient = new PGlite();
    const upgradeDb = drizzle(upgradeClient, { schema });
    try {
      const journalPath = join(migrationsFolder, 'meta', '_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      // Migrate only up to (and including) 0022, before the P6-01 migration.
      const previousEntries = journal.entries.filter((entry) => entry.idx <= 22);
      const previousMetaFolder = join(previousMigrationsFolder, 'meta');
      await mkdir(previousMetaFolder);
      await Promise.all([
        writeFile(
          join(previousMetaFolder, '_journal.json'),
          JSON.stringify({ ...journal, entries: previousEntries }),
        ),
        ...previousEntries.map(({ tag }) =>
          copyFile(join(migrationsFolder, `${tag}.sql`), join(previousMigrationsFolder, `${tag}.sql`)),
        ),
      ]);
      await migrate(upgradeDb, { migrationsFolder: previousMigrationsFolder });

      // Pre-existing workspace and audit row that the migration must not touch.
      // Insert with raw SQL (only pre-0023 columns) because the live Drizzle
      // schema already knows about the new policy columns.
      const workspace = (
        await upgradeDb.execute<{ id: string }>(
          sql`insert into workspaces (name, slug) values ('Legacy policy workspace', 'legacy-policy') returning id`,
        )
      ).rows[0]!;
      const oldOccurredAt = new Date('2020-01-01T00:00:00Z');
      const [legacyAudit] = await upgradeDb
        .insert(schema.auditLog)
        .values({
          workspaceId: workspace!.id,
          action: 'legacy.action',
          resource: 'legacy',
          occurredAt: oldOccurredAt,
        })
        .returning({ id: schema.auditLog.id });

      // Apply the real migration chain (includes 0023). Running twice proves idempotency.
      await migrate(upgradeDb, { migrationsFolder });
      await migrate(upgradeDb, { migrationsFolder });

      const [after] = await upgradeDb
        .select({
          auditRetentionDays: schema.workspaces.auditRetentionDays,
          exportPolicyJson: schema.workspaces.exportPolicyJson,
        })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspace!.id));
      // Existing rows get safe defaults: keep forever, exports enabled with no expiry.
      expect(after?.auditRetentionDays).toBeNull();
      expect(after?.exportPolicyJson).toEqual({ enabled: true, maxAgeDays: null });

      const [survivingAudit] = await upgradeDb
        .select({ occurredAt: schema.auditLog.occurredAt })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.id, legacyAudit!.id));
      expect(survivingAudit?.occurredAt.toISOString()).toBe(oldOccurredAt.toISOString());
    } finally {
      await upgradeClient.close();
      await rm(previousMigrationsFolder, { recursive: true, force: true });
    }
  }, 60_000);

  it('seedRoles mirrors the new fine-grained permissions', async () => {
    await seedRoles(db as unknown as Database);
    const pairs = (
      await db.execute<{ role_key: string; permission_key: string }>(
        sql`select role_key, permission_key from role_permissions where permission_key in ('audit:read','audit:manage','exports:manage') order by role_key, permission_key`,
      )
    ).rows;
    expect(pairs).toEqual([
      { role_key: 'admin', permission_key: 'audit:manage' },
      { role_key: 'admin', permission_key: 'audit:read' },
      { role_key: 'admin', permission_key: 'exports:manage' },
      { role_key: 'auditor', permission_key: 'audit:read' },
      { role_key: 'owner', permission_key: 'audit:manage' },
      { role_key: 'owner', permission_key: 'audit:read' },
      { role_key: 'owner', permission_key: 'exports:manage' },
    ]);
  });

  it('rejects out-of-range audit retention and scopes pruning to one workspace', async () => {
    const [wsA, wsB] = await db
      .insert(schema.workspaces)
      .values([
        { name: 'Retention A', slug: 'retention-a' },
        { name: 'Retention B', slug: 'retention-b' },
      ])
      .returning({ id: schema.workspaces.id });

    // Constraint: finite retention must be within 1..3650.
    await expectPgError(
      db.update(schema.workspaces).set({ auditRetentionDays: 0 }).where(eq(schema.workspaces.id, wsA!.id)),
      /workspaces_audit_retention_days_check/,
    );
    await db
      .update(schema.workspaces)
      .set({ auditRetentionDays: 30 })
      .where(eq(schema.workspaces.id, wsA!.id));

    const now = new Date();
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    await db.insert(schema.auditLog).values([
      { workspaceId: wsA!.id, action: 'a.old', resource: 'test', occurredAt: old },
      { workspaceId: wsA!.id, action: 'a.recent', resource: 'test', occurredAt: recent },
      { workspaceId: wsB!.id, action: 'b.old', resource: 'test', occurredAt: old },
    ]);

    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(schema.auditLog)
      .where(sql`${schema.auditLog.workspaceId} = ${wsA!.id} and ${schema.auditLog.occurredAt} < ${cutoff}`)
      .returning({ id: schema.auditLog.id });
    expect(deleted).toHaveLength(1);

    const remainingA = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsA!.id));
    expect(remainingA.map((r) => r.action)).toEqual(['a.recent']);

    // The other workspace's row is untouched — pruning never crosses tenants.
    const remainingB = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsB!.id));
    expect(remainingB.map((r) => r.action)).toEqual(['b.old']);
  }, 60_000);
});

describe('P6-02 approval workflow schema (0024)', () => {
  it('stores rules, requests and decisions with domain constraints', async () => {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'Approval schema WS', slug: 'approval-schema-ws' })
      .returning({ id: schema.workspaces.id });
    const [approver] = await db
      .insert(schema.users)
      .values({ email: 'approver@test.local', displayName: 'Approver', passwordHash: null })
      .returning({ id: schema.users.id });

    await db.insert(schema.workflowRules).values({
      workspaceId: ws!.id,
      action: 'asset.dispose',
      requiredApprovals: 2,
      approverRoles: ['admin', 'manager'],
      selfApproval: false,
    });

    const [request] = await db
      .insert(schema.approvalRequests)
      .values({
        workspaceId: ws!.id,
        action: 'asset.dispose',
        resourceType: 'asset',
        requiredApprovals: 2,
        approverRoles: ['admin', 'manager'],
        selfApproval: false,
        contextJson: { reason: 'test' },
      })
      .returning({ id: schema.approvalRequests.id });

    await db.insert(schema.approvalDecisions).values({
      requestId: request!.id,
      actorId: approver!.id,
      decision: 'approved',
      note: 'first',
    });

    // One decision per actor per request.
    await expectPgError(
      db
        .insert(schema.approvalDecisions)
        .values({ requestId: request!.id, actorId: approver!.id, decision: 'approved', note: 'again' }),
      /approval_decisions_request_actor_unique/,
    );

    // Closed status/decision domains.
    await expectPgError(
      db
        .update(schema.approvalRequests)
        .set({ status: 'maybe' })
        .where(eq(schema.approvalRequests.id, request!.id)),
      /approval_requests_status_check/,
    );
    await expectPgError(
      db.insert(schema.approvalDecisions).values({ requestId: request!.id, decision: 'maybe' }),
      /approval_decisions_decision_check/,
    );

    // Required approval count is bounded.
    await expectPgError(
      db.insert(schema.workflowRules).values({
        workspaceId: ws!.id,
        action: 'asset.retire',
        requiredApprovals: 0,
        approverRoles: ['admin'],
      }),
      /workflow_rules_required_approvals_check/,
    );
  }, 60_000);
});

describe('AI routing and job constraints', () => {
  it('rejects cross-workspace references and cascades a workspace deletion', async () => {
    const [first, second] = await db
      .insert(schema.workspaces)
      .values([
        { name: 'AI routes A', slug: 'ai-routes-a' },
        { name: 'AI routes B', slug: 'ai-routes-b' },
      ])
      .returning({ id: schema.workspaces.id });
    const [firstConnection, secondConnection] = await db
      .insert(schema.aiConnections)
      .values(
        [first!, second!].map(({ id }) => ({
          workspaceId: id,
          name: 'Local model',
          kind: 'ollama' as const,
          endpoint: 'http://models.example.test:11434',
        })),
      )
      .returning({ id: schema.aiConnections.id });
    const model = { modelId: 'ollama:example', label: 'Example', capabilities: {} };
    await expectPgError(
      db
        .insert(schema.aiModels)
        .values({ ...model, workspaceId: second!.id, connectionId: firstConnection!.id }),
      /ai_models_workspace_connection_fk/,
    );
    const [firstModel, secondModel] = await db
      .insert(schema.aiModels)
      .values([
        { ...model, workspaceId: first!.id, connectionId: firstConnection!.id },
        { ...model, workspaceId: second!.id, connectionId: secondConnection!.id },
      ])
      .returning({ id: schema.aiModels.id });

    const route = { workspaceId: first!.id, task: 'asset_chat' as const, modelId: firstModel!.id };
    await expectPgError(
      db.insert(schema.aiTaskRoutes).values({ ...route, modelId: secondModel!.id }),
      /ai_task_routes_workspace_model_fk/,
    );
    await expectPgError(
      db.insert(schema.aiTaskRoutes).values({ ...route, fallbackModelId: secondModel!.id }),
      /ai_task_routes_workspace_fallback_fk/,
    );
    await expectPgError(
      db.insert(schema.aiTaskRoutes).values({ ...route, fallbackModelId: firstModel!.id }),
      /ai_task_routes_fallback_check/,
    );
    await expectPgError(
      db.insert(schema.aiTaskRoutes).values({ ...route, timeoutMs: 30_001 }),
      /ai_task_routes_timeout_check/,
    );
    const [configured] = await db.insert(schema.aiTaskRoutes).values(route).returning({
      timeoutMs: schema.aiTaskRoutes.timeoutMs,
      maxOutputTokens: schema.aiTaskRoutes.maxOutputTokens,
      dailyTokenBudget: schema.aiTaskRoutes.dailyTokenBudget,
      allowProviderData: schema.aiTaskRoutes.allowProviderData,
    });
    expect(configured).toEqual({
      timeoutMs: 10_000,
      maxOutputTokens: 512,
      dailyTokenBudget: 50_000,
      allowProviderData: false,
    });
    await expectPgError(
      db.delete(schema.aiModels).where(eq(schema.aiModels.id, firstModel!.id)),
      /ai_task_routes_workspace_model_fk/,
    );
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, first!.id));
    const survivingModels = await db.select({ id: schema.aiModels.id }).from(schema.aiModels);
    const survivingRoutes = await db.select({ task: schema.aiTaskRoutes.task }).from(schema.aiTaskRoutes);
    expect(survivingModels.map(({ id }) => id)).toContain(secondModel!.id);
    expect(survivingModels.map(({ id }) => id)).not.toContain(firstModel!.id);
    expect(survivingRoutes).toEqual([]);
  });

  it('allows only one completion and scopes it to the job workspace', async () => {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ name: 'AI jobs workspace', slug: 'ai-job-cas' })
      .returning({ id: schema.workspaces.id });
    const job = {
      workspaceId: workspace!.id,
      actorId: randomUUID(),
      modelId: randomUUID(),
      task: 'natural_language_search',
      providerKind: 'ollama',
      providerModelId: 'example',
      reservedTokens: 128,
    } satisfies typeof schema.aiJobs.$inferInsert;
    await expectPgError(
      db.insert(schema.aiJobs).values({ ...job, reservedTokens: -1 }),
      /ai_jobs_token_reservation_check/,
    );
    const [pending] = await db.insert(schema.aiJobs).values(job).returning({ id: schema.aiJobs.id });
    const complete = (workspaceId: string) =>
      db
        .update(schema.aiJobs)
        .set({ status: 'succeeded', finishedAt: new Date(), outputTokens: 15 })
        .where(
          and(
            eq(schema.aiJobs.workspaceId, workspaceId),
            eq(schema.aiJobs.id, pending!.id),
            eq(schema.aiJobs.status, 'running'),
          ),
        )
        .returning({ id: schema.aiJobs.id });
    await expect(complete(randomUUID())).resolves.toEqual([]);
    const [firstCompletion, duplicateCompletion] = await Promise.all([
      complete(workspace!.id),
      complete(workspace!.id),
    ]);
    expect([...firstCompletion, ...duplicateCompletion]).toEqual([pending]);
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
