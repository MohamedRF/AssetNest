-- Audits: closed domains and resolution states.
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_status_check" CHECK ("status" IN ('open', 'closed'));
--> statement-breakpoint
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_observation_check" CHECK ("observation" IN ('unobserved', 'present', 'missing', 'moved', 'extra'));
