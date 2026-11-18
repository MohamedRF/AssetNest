import { eq, sql } from 'drizzle-orm';
import argon2 from 'argon2';
import { ROLE_PERMISSIONS, WORKSPACE_ROLES } from '@assetnest/domain';
import type { Database } from './client.js';
import { categories, locations, memberships, rolePermissions, roles, users, workspaces } from './schema.js';

/** Seed library — importable without side effects. CLI wrapper: seed.ts. */

const ROLE_DESCRIPTIONS: Record<(typeof WORKSPACE_ROLES)[number], string> = {
  owner: 'Workspace owner — full administrative control incl. ownership transfer and secrets',
  admin: 'Workspace admin — asset lifecycle, users/roles, reports, integrations',
  manager: 'Manager — create/edit/assign assets, maintenance and audits; no secrets',
  member: 'Member — read permitted assets and own custody events',
  auditor: 'Auditor — audit and read-only scope; no asset destruction',
};

export async function seedRoles(db: Database): Promise<void> {
  for (const key of WORKSPACE_ROLES) {
    await db
      .insert(roles)
      .values({ key, description: ROLE_DESCRIPTIONS[key] })
      .onConflictDoNothing({ target: roles.key });
    for (const permission of ROLE_PERMISSIONS[key]) {
      await db
        .insert(rolePermissions)
        .values({ roleKey: key, permissionKey: permission })
        .onConflictDoNothing();
    }
  }
}

export async function seedAdmin(
  db: Database,
  email: string,
  password: string,
): Promise<{ id: string; created: boolean }> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (existing) return { id: existing.id, created: false };
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const [created] = await db
    .insert(users)
    .values({ email: normalized, displayName: 'AssetNest Admin', passwordHash })
    .returning({ id: users.id });
  if (!created) throw new Error('Failed to create bootstrap admin user');
  return { id: created.id, created: true };
}

export async function seedDemoWorkspaces(db: Database, adminId: string): Promise<void> {
  const demo = [
    {
      name: 'Home',
      mode: 'home' as const,
      slug: 'home-demo',
      location: 'Living Room',
      category: 'Appliances',
    },
    {
      name: 'Demo Office',
      mode: 'office' as const,
      slug: 'office-demo',
      location: 'HQ / Floor 1',
      category: 'IT Equipment',
    },
  ];
  for (const d of demo) {
    const [ws] = await db
      .insert(workspaces)
      .values({ name: d.name, mode: d.mode, slug: d.slug })
      .onConflictDoNothing({ target: workspaces.slug })
      .returning({ id: workspaces.id });
    const workspaceId =
      ws?.id ??
      (await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, d.slug)).limit(1))[0]
        ?.id;
    if (!workspaceId) throw new Error(`Failed to upsert demo workspace ${d.slug}`);

    await db
      .insert(memberships)
      .values({ workspaceId, userId: adminId, roleKey: 'owner' })
      .onConflictDoNothing();

    const [existingLocation] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(
        sql`${locations.workspaceId} = ${workspaceId} and lower(${locations.name}) = lower(${d.location})`,
      )
      .limit(1);
    if (!existingLocation) {
      const locationPath = `/${d.location.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      await db.insert(locations).values({
        workspaceId,
        name: d.location,
        type: d.mode === 'home' ? 'room' : 'building',
        path: locationPath,
      });
    }

    const [existingCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        sql`${categories.workspaceId} = ${workspaceId} and lower(${categories.name}) = lower(${d.category})`,
      )
      .limit(1);
    if (!existingCategory) {
      await db.insert(categories).values({ workspaceId, name: d.category });
    }
  }
}
