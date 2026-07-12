-- Multi-tenant Row-Level Security.
-- The API connects as a NON-owner role (RLS applies to it) and, per request, sets the tenant:
--   select set_config('app.current_tenant', '<tenant-uuid>', true)   (see withTenant in client.ts).
-- Migrations & the seed run as the table owner, which BYPASSES RLS.

CREATE OR REPLACE FUNCTION current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_tenant', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "workflows" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "workflow_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "workflow_stages" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "lead_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lead_configs" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leads" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_self" ON "tenants" USING ("id" = current_tenant()) WITH CHECK ("id" = current_tenant());
