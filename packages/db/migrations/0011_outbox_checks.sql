-- Outbox: closed-domain channels and delivery statuses.
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_channel_check" CHECK ("channel" IN ('log', 'email', 'webhook'));
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_check" CHECK ("channel" IN ('log', 'email'));
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped'));
