-- The case's written journal: comments people leave (optionally pinned to one
-- checklist item) and events the system records as they happen (stage moves,
-- document reviews). One table because a reader asks one question: "what went
-- on here, and who did it". author_name is denormalised so the audit trail
-- survives account deletion. Tenant-scoped like every case artifact.

CREATE TABLE "case_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "requirement_id" uuid REFERENCES "document_requirements"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "author_name" text,
  "body" text,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_events_kind_check" CHECK ("kind" IN ('comment', 'stage_changed', 'document_reviewed')),
  -- A comment must say something; an event needs no prose.
  CONSTRAINT "case_events_comment_body_check" CHECK ("kind" <> 'comment' OR ("body" IS NOT NULL AND length(trim("body")) > 0))
);--> statement-breakpoint
CREATE INDEX "case_events_tenant_idx" ON "case_events" ("tenant_id");--> statement-breakpoint
CREATE INDEX "case_events_case_created_idx" ON "case_events" ("case_id", "created_at");--> statement-breakpoint

-- RLS: tenant-scoped exactly like case_messages. ALTER DEFAULT PRIVILEGES
-- grants the app role access the moment the table exists, so the policy is
-- what confines it.
ALTER TABLE "case_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "case_events" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
