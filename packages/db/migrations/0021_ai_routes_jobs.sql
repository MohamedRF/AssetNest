CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"task" text NOT NULL,
	"model_id" uuid,
	"provider_kind" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_code" text,
	"duration_ms" integer,
	"source_document_id" uuid,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_jobs_task_check" CHECK ("ai_jobs"."task" IN ('invoice_extraction', 'image_tagging', 'natural_language_search', 'maintenance_assistant', 'asset_chat')),
	CONSTRAINT "ai_jobs_provider_kind_check" CHECK ("ai_jobs"."provider_kind" IN ('openai', 'anthropic', 'gemini', 'openai_compatible', 'ollama')),
	CONSTRAINT "ai_jobs_provider_model_check" CHECK (length(btrim("ai_jobs"."provider_model_id")) BETWEEN 1 AND 255),
	CONSTRAINT "ai_jobs_status_check" CHECK ("ai_jobs"."status" IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "ai_jobs_token_reservation_check" CHECK ("ai_jobs"."reserved_tokens" BETWEEN 1 AND 1000000),
	CONSTRAINT "ai_jobs_input_tokens_check" CHECK ("ai_jobs"."input_tokens" >= 0),
	CONSTRAINT "ai_jobs_output_tokens_check" CHECK ("ai_jobs"."output_tokens" >= 0),
	CONSTRAINT "ai_jobs_duration_check" CHECK ("ai_jobs"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_connection_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_model_id_check" CHECK (length(btrim("ai_models"."model_id")) BETWEEN 1 AND 255),
	CONSTRAINT "ai_models_label_check" CHECK (length(btrim("ai_models"."label")) BETWEEN 1 AND 255),
	CONSTRAINT "ai_models_capabilities_check" CHECK (jsonb_typeof("ai_models"."capabilities") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai_task_routes" (
	"workspace_id" uuid NOT NULL,
	"task" text NOT NULL,
	"model_id" uuid NOT NULL,
	"fallback_model_id" uuid,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"max_output_tokens" integer DEFAULT 512 NOT NULL,
	"daily_token_budget" integer DEFAULT 50000 NOT NULL,
	"allow_provider_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_task_routes_workspace_task_pk" PRIMARY KEY("workspace_id","task"),
	CONSTRAINT "ai_task_routes_task_check" CHECK ("ai_task_routes"."task" IN ('invoice_extraction', 'image_tagging', 'natural_language_search', 'maintenance_assistant', 'asset_chat')),
	CONSTRAINT "ai_task_routes_fallback_check" CHECK ("ai_task_routes"."fallback_model_id" IS NULL OR "ai_task_routes"."fallback_model_id" <> "ai_task_routes"."model_id"),
	CONSTRAINT "ai_task_routes_timeout_check" CHECK ("ai_task_routes"."timeout_ms" BETWEEN 1000 AND 30000),
	CONSTRAINT "ai_task_routes_output_limit_check" CHECK ("ai_task_routes"."max_output_tokens" BETWEEN 16 AND 4096),
	CONSTRAINT "ai_task_routes_budget_check" CHECK ("ai_task_routes"."daily_token_budget" BETWEEN 32 AND 1000000)
);
--> statement-breakpoint
-- PostgreSQL requires the referenced tenant keys to be unique before adding composite foreign keys.
CREATE UNIQUE INDEX "ai_models_workspace_id_unique" ON "ai_models" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connections_workspace_id_unique" ON "ai_connections" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_workspace_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."ai_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_workspace_model_fk" FOREIGN KEY ("workspace_id","model_id") REFERENCES "public"."ai_models"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_workspace_fallback_fk" FOREIGN KEY ("workspace_id","fallback_model_id") REFERENCES "public"."ai_models"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_workspace_task_created_idx" ON "ai_jobs" USING btree ("workspace_id","task","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_workspace_id_idx" ON "ai_jobs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_workspace_connection_model_unique" ON "ai_models" USING btree ("workspace_id","connection_id","model_id");
