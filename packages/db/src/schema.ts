import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * AssetNest Drizzle schema.
 * Conventions:
 *  - Tenant-scoped tables carry workspace_id (uuid, indexed).
 *  - UUID primary keys; UTC timestamptz; amounts numeric(18,2) with ISO currency.
 *  - Serial numbers are text (preserve leading zeros).
 *  - Additive migrations only; never edit a migration that has been deployed.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// ─── Migration 001 — identities & workspaces ─────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    // NULL for passwordless (e.g. OIDC subject-only) accounts
    passwordHash: text('password_hash'),
    authSubject: text('auth_subject'),
    status: text('status').notNull().default('active'),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    mode: text('mode').notNull().default('office'), // 'home' | 'office' (check constraint in SQL)
    slug: text('slug').notNull(),
    settingsJson: jsonb('settings_json').notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('workspaces_slug_unique').on(t.slug)],
);

// Built-in role catalog. workspace_id is reserved for future workspace-custom roles;
// built-ins have NULL workspace_id and a globally unique key.
export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  createdAt: timestamps.createdAt,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [uniqueIndex('role_permissions_pair_unique').on(t.roleKey, t.permissionKey)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key),
    status: text('status').notNull().default('active'), // 'invited' | 'active' | 'suspended'
    ...timestamps,
  },
  (t) => [
    uniqueIndex('memberships_workspace_user_unique').on(t.workspaceId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamps.createdAt,
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: uuid('resource_id'),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_workspace_time_idx').on(t.workspaceId, t.occurredAt)],
);

// ─── Migration 002 — locations, categories, vendors, asset models ────────────

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'), // self-FK added via raw SQL in migration (acyclic enforcement lives in service layer)
    name: text('name').notNull(),
    type: text('type').notNull().default('room'), // 'building' | 'floor' | 'room' | 'shelf' | 'area' | 'other'
    path: text('path').notNull().default('/'),
    ...timestamps,
  },
  (t) => [
    index('locations_workspace_parent_idx').on(t.workspaceId, t.parentId),
    index('locations_workspace_path_idx').on(t.workspaceId, t.path),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    schemaJson: jsonb('schema_json').notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('categories_workspace_name_unique').on(t.workspaceId, sql`lower(${t.name})`)],
);

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contactJson: jsonb('contact_json').notNull().default({}),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('vendors_workspace_name_idx').on(t.workspaceId, t.name)],
);

export const assetModels = pgTable(
  'asset_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    maker: text('maker').notNull(),
    modelName: text('model_name').notNull(),
    ...timestamps,
  },
  (t) => [index('asset_models_workspace_maker_idx').on(t.workspaceId, t.maker)],
);

// ─── Migration 003 — assets, events, assignments, transfers ──────────────────

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetTag: text('asset_tag').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    modelId: uuid('model_id').references(() => assetModels.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    custodianMembershipId: uuid('custodian_membership_id').references(() => memberships.id, {
      onDelete: 'set null',
    }),
    displayName: text('display_name').notNull(),
    serialNumber: text('serial_number'), // text on purpose: leading zeros are data
    status: text('status').notNull().default('available'),
    condition: text('condition').notNull().default('good'),
    version: integer('version').notNull().default(1),
    purchasedAt: date('purchased_at'),
    amount: numeric('amount', { precision: 18, scale: 2 }),
    currency: text('currency'),
    notes: text('notes'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('assets_workspace_tag_unique').on(t.workspaceId, t.assetTag),
    index('assets_workspace_status_idx').on(t.workspaceId, t.status),
    index('assets_workspace_location_idx').on(t.workspaceId, t.locationId),
    index('assets_workspace_category_idx').on(t.workspaceId, t.categoryId),
  ],
);

export const assetCustomValues = pgTable(
  'asset_custom_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    jsonValue: jsonb('json_value').notNull(),
  },
  (t) => [uniqueIndex('asset_custom_values_asset_field_unique').on(t.assetId, t.fieldKey)],
);

export const assetTags = pgTable(
  'asset_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(), // normalized lowercase in the application layer
  },
  (t) => [
    uniqueIndex('asset_tags_asset_tag_unique').on(t.assetId, t.tag),
    index('asset_tags_workspace_tag_idx').on(t.workspaceId, t.tag),
  ],
);

export const assetEvents = pgTable(
  'asset_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    correlationId: uuid('correlation_id').notNull().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('asset_events_workspace_asset_time_idx').on(t.workspaceId, t.assetId, t.occurredAt)],
);

export const assetAssignments = pgTable(
  'asset_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    status: text('status').notNull().default('active'), // 'active' | 'returned'
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    returnedBy: uuid('returned_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
  },
  (t) => [
    // Invariant: at most one ACTIVE assignment per asset
    uniqueIndex('asset_assignments_one_active')
      .on(t.workspaceId, t.assetId)
      .where(sql`${t.returnedAt} is null`),
    index('asset_assignments_workspace_member_idx').on(t.workspaceId, t.memberId),
  ],
);

export const assetTransfers = pgTable(
  'asset_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    fromLocationId: uuid('from_location_id').references(() => locations.id, { onDelete: 'set null' }),
    toLocationId: uuid('to_location_id').references(() => locations.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (t) => [index('asset_transfers_workspace_asset_time_idx').on(t.workspaceId, t.assetId, t.movedAt)],
);
