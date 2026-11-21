# Database Design (PostgreSQL + Drizzle)

## 1. Conventions

All tenant-scoped rows contain `workspace_id` (UUID, indexed); scope uniqueness accordingly. Primary IDs are UUID; timestamps are UTC `timestamptz`; amount `numeric(18,2)` with ISO currency code; serial numbers stay text (preserve leading zeros); `created_at`, `updated_at`, optional `deleted_at` where documented. Every FK constrains cross-workspace references, preferably composite `(workspace_id,id)` in sensitive tables. Use typed enum/check constraints and additive migrations.

## 2. Initial entity catalog

| Table                    | Essential fields                                                                                                                                                              | Constraints / indexes                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| users                    | id, email, display_name, auth_subject, status                                                                                                                                 | normalized unique email                                           |
| workspaces               | id, name, mode(home/office), slug, settings_json                                                                                                                              | unique slug                                                       |
| memberships              | id, workspace_id, user_id, role_id, status                                                                                                                                    | unique(workspace_id,user_id)                                      |
| roles                    | id, workspace_id nullable for built-ins, key, description                                                                                                                     | unique per scope/key                                              |
| role_permissions         | role_id, permission_key                                                                                                                                                       | unique pair                                                       |
| locations                | id, workspace_id, parent_id, name, type, path                                                                                                                                 | indexed parent; prevent cycles                                    |
| categories               | id, workspace_id, name, schema_json                                                                                                                                           | unique scoped name                                                |
| vendors                  | id, workspace_id, name, contact_json                                                                                                                                          | scoped indexes                                                    |
| asset_models             | id, workspace_id, category_id, maker, model_name                                                                                                                              | optional scoped uniqueness                                        |
| assets                   | id, workspace_id, asset_tag, category_id, model_id, location_id, custodian_id, serial_number, display_name, status, condition, version, purchased_at, amount, currency, notes | unique(workspace_id,asset_tag); indexes(status,location,category) |
| asset_custom_values      | workspace_id, asset_id, field_key, json_value                                                                                                                                 | unique(asset_id,field_key)                                        |
| asset_tags               | workspace_id, asset_id, tag                                                                                                                                                   | unique(asset_id,tag)                                              |
| asset_events             | id, workspace_id, asset_id, actor_id, action, before_json, after_json, occurred_at, correlation_id                                                                            | append-only; asset+time index                                     |
| asset_assignments        | id, workspace_id, asset_id, member_id, assigned_at, returned_at, status                                                                                                       | at most one active per asset                                      |
| asset_transfers          | id, workspace_id, asset_id, from_location_id, to_location_id, actor_id, moved_at                                                                                              | indexed asset/time                                                |
| documents                | id, workspace_id, asset_id, kind, original_name, object_key, mime, size, checksum, uploaded_by                                                                                | private object key and asset index                                |
| warranties               | id, workspace_id, asset_id, provider, starts_on, expires_on, details                                                                                                          | asset+expiry index                                                |
| maintenance_plans        | id, workspace_id, asset_id, title, cadence, next_due_at, enabled                                                                                                              | due index                                                         |
| maintenance_records      | id, workspace_id, asset_id, plan_id, performed_at, provider_id, cost, currency, notes                                                                                         | asset+date                                                        |
| audit_sessions           | id, workspace_id, scope_json, status, opened_by, closed_by, opened_at, closed_at                                                                                              | status/date index                                                 |
| audit_items              | id, workspace_id, audit_id, asset_id, observation, observed_location_id, observed_by, observed_at                                                                             | unique(audit_id,asset_id)                                         |
| notification_preferences | id, workspace_id, member_id, channel, event, enabled                                                                                                                          | scoped uniqueness                                                 |
| notification_deliveries  | id, workspace_id, event_key, recipient, channel, status, attempts                                                                                                             | unique(event_key,recipient,channel)                               |
| imports                  | id, workspace_id, requested_by, object_key, status, counts_json, validation_json                                                                                              | scoped status index                                               |
| integration_connections  | id, workspace_id, provider, state, config_json, encrypted_secret_ref                                                                                                          | never store plaintext secrets                                     |
| api_tokens               | id, workspace_id, owner_id, token_hash, scopes_json, expires_at, revoked_at                                                                                                   | hash index                                                        |
| webhook_subscriptions    | id, workspace_id, url, secret_ref, event_types, active                                                                                                                        | workspace index                                                   |
| webhook_deliveries       | id, workspace_id, subscription_id, event_id, attempt, response_code, status                                                                                                   | event+subscription uniqueness policy                              |
| outbox_events            | id, workspace_id, kind, aggregate_id, payload_json, occurred_at, published_at                                                                                                 | unprocessed index                                                 |
| audit_log                | id, workspace_id, actor_id, action, resource, resource_id, metadata_json, occurred_at                                                                                         | immutable chronological index                                     |
| ai_connections           | id, workspace_id, provider_type, name, endpoint, auth_mode, secret_ref, enabled                                                                                               | endpoint validation policy                                        |
| ai_models                | id, workspace_id, connection_id, model_id, capabilities_json, verified_at                                                                                                     | scoped uniqueness                                                 |
| ai_task_routes           | workspace_id, task_key, primary_model_id, fallback_models_json, limit_config                                                                                                  | task uniqueness                                                   |
| ai_jobs                  | id, workspace_id, actor_id, task, provider_id, model_id, status, input_ref, output_json, token_usage_json, cost_estimate, error_code                                          | scoped time/status                                                |
| ai_approval_actions      | id, workspace_id, ai_job_id, proposed_json, approved_by, decision, decided_at                                                                                                 | approvals trace                                                   |

## 3. Domain invariants

- One current active assignment per asset: use partial unique index on `(workspace_id,asset_id)` where `returned_at IS NULL`.
- Location tree must be acyclic and cannot cross workspace.
- Asset tag immutable by default or changeable only with admin action recorded in history.
- Soft-deleted asset is excluded from normal searches but retains relationships and audit evidence.
- Audit session cannot be modified after close except via explicit admin correction record.
- Expired warranty is derived from `expires_on`, not a separately persisted status unless needed for projections.
- Enforce foreign keys and scoped authorization on every service method; database RLS can be added as defense in depth with safe context binding.

## 4. Migration sequence

001 identities/workspaces; 002 locations/categories/vendors; 003 assets/events/assignments; 004 documents; 005 maintenance/warranties; 006 audits/imports; 007 outbox/webhooks; 008 AI provider metadata/jobs. Never edit a migration deployed to production. Tests must migrate from empty DB and against realistic upgrade snapshots.

## 5. Reporting

Create SQL views/read models only after measuring actual queries; avoid premature denormalization. Use indexes with EXPLAIN ANALYZE; design export streaming rather than collecting entire data set in memory.
