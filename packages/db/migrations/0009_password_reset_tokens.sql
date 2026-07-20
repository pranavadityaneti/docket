-- Password-reset tokens — global (per-user), not tenant-scoped. Reached only via
-- the owner role in the pre-auth flow, exactly as login reads users. No
-- tenant_id, no RLS.
CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");--> statement-breakpoint
-- New tables inherit ALTER DEFAULT PRIVILEGES grants to the tenant-scoped app
-- role, and with no tenant_id there is no RLS policy to isolate by. These tokens
-- are pre-auth and global, touched only by the owner role — so close the door
-- the default grant opens rather than leave the app role able to read every
-- user's tokens.
REVOKE ALL ON "password_reset_tokens" FROM "docket_app";
