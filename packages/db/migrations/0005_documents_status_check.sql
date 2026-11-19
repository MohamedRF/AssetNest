-- Documents: kind is a closed domain; size must be non-negative. Enforced at the DB layer as well as in DTOs.
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_check" CHECK ("kind" IN ('invoice', 'warranty', 'manual', 'service_evidence', 'photo', 'other'));
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_check" CHECK ("size" >= 0);
