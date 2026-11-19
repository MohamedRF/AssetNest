-- Webhooks: closed delivery-status domain.
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_status_check" CHECK ("status" IN ('pending', 'delivered', 'failed'));
