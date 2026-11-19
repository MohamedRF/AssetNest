-- Exports: closed report + status domains.
ALTER TABLE "exports" ADD CONSTRAINT "exports_report_check" CHECK ("report" IN ('assets', 'warranties', 'maintenance'));
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_status_check" CHECK ("status" IN ('pending', 'completed', 'failed'));
