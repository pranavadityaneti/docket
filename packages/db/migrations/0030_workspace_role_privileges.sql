-- Per-tenant privilege templates for Admin / Agent / Reviewer.
-- Owner always has every permission and is not stored here.
-- Missing rows mean the role uses DEFAULT_WORKSPACE_PRIVILEGES.
CREATE TABLE "workspace_role_privileges" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "privileges" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_role_privileges_role_check" CHECK ("role" IN ('admin', 'agent', 'reviewer'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_role_privileges_tenant_role_uq" ON "workspace_role_privileges" ("tenant_id", "role");--> statement-breakpoint
CREATE INDEX "workspace_role_privileges_tenant_idx" ON "workspace_role_privileges" ("tenant_id");--> statement-breakpoint
ALTER TABLE "workspace_role_privileges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "workspace_role_privileges" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
