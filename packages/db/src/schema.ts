import {
  bigint,
  boolean,
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

// ─── Maintenance ────────────────────────────────────────────────────────────

export const maintenancePlans = pgTable(
  'maintenance_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    cadence: text('cadence').notNull(), // 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'once'
    nextDueAt: date('next_due_at').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('maintenance_plans_workspace_due_idx').on(t.workspaceId, t.nextDueAt),
    index('maintenance_plans_workspace_asset_idx').on(t.workspaceId, t.assetId),
  ],
);

export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => maintenancePlans.id, { onDelete: 'set null' }),
    performedAt: date('performed_at').notNull(),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    cost: numeric('cost', { precision: 18, scale: 2 }),
    currency: text('currency'),
    notes: text('notes'),
    createdById: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('maintenance_records_workspace_asset_date_idx').on(t.workspaceId, t.assetId, t.performedAt)],
);

// ─── Imports (CSV/JSON bulk ingest jobs) ───────────────────────────────────

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    objectKey: text('object_key').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'partial' | 'failed'
    countsJson: jsonb('counts_json').notNull().default({}),
    validationJson: jsonb('validation_json').notNull().default({}),
    ...timestamps,
  },
  (t) => [index('imports_workspace_status_idx').on(t.workspaceId, t.status)],
);

// ─── Exports (generated report files) ───────────────────────────────────────

export const exports = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    report: text('report').notNull(), // 'assets' | 'warranties' | 'maintenance'
    objectKey: text('object_key').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'completed' | 'failed'
    ...timestamps,
  },
  (t) => [index('exports_workspace_time_idx').on(t.workspaceId, t.createdAt)],
);

// ─── API tokens (automation credentials) ────────────────────────────────────

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopesJson: jsonb('scopes_json').notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('api_tokens_token_hash_unique').on(t.tokenHash),
    index('api_tokens_workspace_idx').on(t.workspaceId),
  ],
);

// ─── Transactional outbox & notification delivery ───────────────────────────

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payloadJson: jsonb('payload_json').notNull().default({}),
    schemaVersion: integer('schema_version').notNull().default(1),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_events_unpublished_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // 'log' | 'email' | 'webhook'
    event: text('event').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('notification_preferences_unique').on(t.workspaceId, t.memberId, t.channel, t.event)],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    eventKey: uuid('event_key').notNull(),
    recipient: text('recipient').notNull(),
    channel: text('channel').notNull(), // 'log' | 'email'
    status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'failed' | 'skipped'
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex('notification_deliveries_unique').on(t.eventKey, t.recipient, t.channel)],
);

// ─── Warranties ─────────────────────────────────────────────────────────────

export const warranties = pgTable(
  'warranties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    startsOn: date('starts_on').notNull(),
    expiresOn: date('expires_on').notNull(),
    details: text('details'),
    ...timestamps,
  },
  (t) => [
    index('warranties_workspace_asset_idx').on(t.workspaceId, t.assetId),
    index('warranties_workspace_expiry_idx').on(t.workspaceId, t.expiresOn),
  ],
);

// ─── Audit sessions & items ─────────────────────────────────────────────────

export const auditSessions = pgTable(
  'audit_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    scopeJson: jsonb('scope_json').notNull().default({}),
    status: text('status').notNull().default('open'), // 'open' | 'closed'
    openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('audit_sessions_workspace_status_idx').on(t.workspaceId, t.status)],
);

export const auditItems = pgTable(
  'audit_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => auditSessions.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    observation: text('observation').notNull().default('unobserved'), // 'unobserved' | 'present' | 'missing' | 'moved' | 'extra'
    observedLocationId: uuid('observed_location_id').references(() => locations.id, { onDelete: 'set null' }),
    observedBy: uuid('observed_by').references(() => users.id, { onDelete: 'set null' }),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('audit_items_unique').on(t.auditId, t.assetId),
    index('audit_items_workspace_audit_idx').on(t.workspaceId, t.auditId),
  ],
);

// ─── Documents (private attachments) ────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'invoice' | 'warranty' | 'manual' | 'service_evidence' | 'photo' | 'other'
    originalName: text('original_name').notNull(),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('documents_object_key_unique').on(t.objectKey),
    index('documents_workspace_asset_idx').on(t.workspaceId, t.assetId),
  ],
);

// ─── Migration 0004 — workspace invites (single-use, hashed at rest) ─────────

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(), // stored lower-cased
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'revoked'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamps.createdAt,
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('workspace_invites_token_hash_unique').on(t.tokenHash),
    // At most one pending invite per email per workspace
    uniqueIndex('workspace_invites_pending_unique')
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    index('workspace_invites_workspace_idx').on(t.workspaceId),
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
