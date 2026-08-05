-- A tenant's own inbound channel: the mailbox or WhatsApp number a subject
-- writes to. Per-tenant because Docket is white-labelled - a borrower must see
-- their own lender's address, never ours.
--
-- Credentials live only in secret_ciphertext (AES-256-GCM, see secret-box.ts).
-- Nothing here is readable as a password even with a copy of the database.
CREATE TABLE "channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "address" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secret_ciphertext" text,
  "cursor" text,
  "last_polled_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "channels_kind_check" CHECK ("kind" IN ('email', 'whatsapp'))
);--> statement-breakpoint
CREATE INDEX "channels_tenant_idx" ON "channels" ("tenant_id");--> statement-breakpoint
-- Re-adding the same mailbox to a tenant is a mistake, not a second channel.
CREATE UNIQUE INDEX "channels_tenant_kind_address_uq" ON "channels" ("tenant_id", "kind", "address");--> statement-breakpoint
-- "which channels are due a poll?" - asked across all tenants by the poller.
CREATE INDEX "channels_kind_enabled_idx" ON "channels" ("kind", "enabled");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS. Unlike password_reset_tokens (global, per-user), channels IS tenant
-- scoped, so it gets the same isolation as every other tenant table. The mail
-- poller runs outside any request and reads across tenants as the owner role,
-- exactly as login does; every write it performs is done inside withTenant().
--
-- Enabling RLS is NOT automatic on a new table - ALTER DEFAULT PRIVILEGES
-- grants the app role access the moment the table exists, and without a policy
-- that access would be unscoped.
-- ---------------------------------------------------------------------------
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channels" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
