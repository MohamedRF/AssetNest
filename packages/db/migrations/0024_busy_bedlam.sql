CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"decision" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"requested_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"required_approvals" integer NOT NULL,
	"approver_roles" text[] NOT NULL,
	"self_approval" boolean DEFAULT false NOT NULL,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action" text NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"approver_roles" text[] NOT NULL,
	"self_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_request_actor_unique" ON "approval_decisions" USING btree ("request_id","actor_id");--> statement-breakpoint
CREATE INDEX "approval_requests_workspace_status_idx" ON "approval_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_rules_workspace_action_unique" ON "workflow_rules" USING btree ("workspace_id","action");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled', 'executed'));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_required_approvals_check" CHECK ("required_approvals" between 1 and 10);--> statement-breakpoint
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_required_approvals_check" CHECK ("required_approvals" between 1 and 10);--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decision_check" CHECK ("decision" IN ('approved', 'rejected'));