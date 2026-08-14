-- Super admin edits which console features admin / sub-admin may use.
-- Super admin itself is always fully privileged and is not stored here.
CREATE TABLE "platform_role_privileges" (
  "role" text PRIMARY KEY NOT NULL,
  "privileges" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_role_privileges_role_check" CHECK ("role" IN ('admin', 'sub_admin'))
);--> statement-breakpoint
INSERT INTO "platform_role_privileges" ("role", "privileges") VALUES
  ('admin', '["tenants.read","tenants.write","tenants.credentials","tenants.delete"]'::jsonb),
  ('sub_admin', '["tenants.read"]'::jsonb);--> statement-breakpoint
REVOKE ALL ON "platform_role_privileges" FROM "docket_app";
