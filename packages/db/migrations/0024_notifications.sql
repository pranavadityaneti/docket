-- Workspace notifications: the inbox behind the bell.
-- Tenant-scoped so every member sees operational alerts for this workspace.
-- user_id is nullable for workspace-wide items; set later for per-person DMs.

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "case_id" uuid REFERENCES "cases"("id") ON DELETE SET NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
    'document_received',
    'document_needs_review',
    'unmatched',
    'follow_up_due',
    'comment',
    'stage_changed',
    'generic'
  ))
);--> statement-breakpoint
CREATE INDEX "notifications_tenant_created_idx" ON "notifications" ("tenant_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "notifications_tenant_unread_idx" ON "notifications" ("tenant_id", "created_at" DESC) WHERE "read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
