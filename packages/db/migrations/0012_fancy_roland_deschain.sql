CREATE TABLE "audit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"observation" text DEFAULT 'unobserved' NOT NULL,
	"observed_location_id" uuid,
	"observed_by" uuid,
	"observed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "audit_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"scope_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" uuid,
	"closed_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_audit_id_audit_sessions_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_observed_location_id_locations_id_fk" FOREIGN KEY ("observed_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_observed_by_users_id_fk" FOREIGN KEY ("observed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_items_unique" ON "audit_items" USING btree ("audit_id","asset_id");--> statement-breakpoint
CREATE INDEX "audit_items_workspace_audit_idx" ON "audit_items" USING btree ("workspace_id","audit_id");--> statement-breakpoint
CREATE INDEX "audit_sessions_workspace_status_idx" ON "audit_sessions" USING btree ("workspace_id","status");