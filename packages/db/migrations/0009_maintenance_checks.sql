-- Maintenance: closed-domain cadence, non-negative cost, ISO currency.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_cadence_check" CHECK ("cadence" IN ('monthly', 'quarterly', 'semiannual', 'yearly', 'once'));
--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);
--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');
