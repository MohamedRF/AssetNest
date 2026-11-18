-- Invite status is a closed domain; enforced at the DB layer as well as in DTOs.
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_status_check" CHECK ("status" IN ('pending', 'accepted', 'revoked'));
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_expiry_check" CHECK ("expires_at" > "created_at");
