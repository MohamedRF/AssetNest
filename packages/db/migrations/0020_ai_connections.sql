CREATE TABLE "ai_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"endpoint" text,
	"credential_mode" text DEFAULT 'none' NOT NULL,
	"encrypted_credential" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connections_kind_check" CHECK ("ai_connections"."kind" IN ('openai', 'anthropic', 'gemini', 'openai_compatible', 'ollama')),
	CONSTRAINT "ai_connections_name_check" CHECK (length(btrim("ai_connections"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "ai_connections_endpoint_check" CHECK ((
        ("ai_connections"."kind" IN ('openai', 'anthropic', 'gemini') AND "ai_connections"."endpoint" IS NULL)
        OR ("ai_connections"."kind" IN ('openai_compatible', 'ollama') AND "ai_connections"."endpoint" IS NOT NULL AND length(btrim("ai_connections"."endpoint")) > 0)
      )),
	CONSTRAINT "ai_connections_credential_check" CHECK ((
        ("ai_connections"."credential_mode" = 'api_key' AND "ai_connections"."encrypted_credential" IS NOT NULL AND "ai_connections"."encrypted_credential" <> '')
        OR ("ai_connections"."kind" IN ('openai_compatible', 'ollama') AND "ai_connections"."credential_mode" = 'none' AND "ai_connections"."encrypted_credential" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connections_workspace_name_unique" ON "ai_connections" USING btree ("workspace_id","name");