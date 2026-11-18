-- Defense-in-depth constraints not expressible in the Drizzle DSL.
-- Acyclic location trees are primarily enforced in the service layer; the composite FK below makes cross-workspace parentage impossible at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS "locations_workspace_id_id_unique" ON "locations" ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_workspace_fk" FOREIGN KEY ("workspace_id", "parent_id") REFERENCES "locations" ("workspace_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled'));
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_mode_check" CHECK ("mode" IN ('home', 'office'));
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_check" CHECK ("status" IN ('invited', 'active', 'suspended'));
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_type_check" CHECK ("type" IN ('building', 'floor', 'room', 'shelf', 'area', 'other'));
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_status_check" CHECK ("status" IN ('available', 'assigned', 'checked_out', 'in_repair', 'lost', 'retired', 'disposed', 'archived'));
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_condition_check" CHECK ("condition" IN ('new', 'good', 'fair', 'poor', 'damaged', 'unknown'));
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0);
--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_status_check" CHECK ("status" IN ('active', 'returned'));
