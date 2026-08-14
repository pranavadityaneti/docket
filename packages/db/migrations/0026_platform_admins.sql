-- Platform super-admins - global, not tenant-scoped. Reached only via the
-- owner role from the platform console. No tenant_id, no RLS.
CREATE TABLE "platform_admins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);--> statement-breakpoint
-- New tables inherit ALTER DEFAULT PRIVILEGES grants to the tenant-scoped app
-- role, and with no tenant_id there is no RLS policy to isolate by. Close the
-- door the default grant opens rather than leave a tenant connection able to
-- read platform credentials.
REVOKE ALL ON "platform_admins" FROM "docket_app";
