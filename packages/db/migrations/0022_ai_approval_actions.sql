CREATE TABLE "ai_approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ai_job_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"asset_ids" uuid[] NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_approval_actions_decision_check" CHECK ("ai_approval_actions"."decision" = 'approved'),
	CONSTRAINT "ai_approval_actions_assets_check" CHECK (cardinality("ai_approval_actions"."asset_ids") BETWEEN 1 AND 100 AND array_position("ai_approval_actions"."asset_ids", NULL) IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_id_workspace_unique" ON "ai_jobs" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "ai_approval_actions" ADD CONSTRAINT "ai_approval_actions_job_workspace_fk" FOREIGN KEY ("ai_job_id","workspace_id") REFERENCES "public"."ai_jobs"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_approval_actions_workspace_job_unique" ON "ai_approval_actions" USING btree ("workspace_id","ai_job_id");