-- Warranties: expiry must not precede start. Enforced at the DB layer as well as in DTOs.
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_date_order_check" CHECK ("expires_on" >= "starts_on");
